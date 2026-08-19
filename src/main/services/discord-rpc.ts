/**
 * Minimal Discord Rich Presence client that speaks Discord's local IPC protocol over a
 * named pipe (Windows) or unix socket (macOS/Linux) — no native modules, no network.
 *
 * The Discord *application id* comes from the `NOXARA_DISCORD_APP_ID` environment
 * variable, falling back to the baked-in `DISCORD_APP_ID` constant. Application ids
 * are public (never secrets); the env var lets every fork override it with its own
 * Discord application. If no id resolves at all the client simply stays disconnected
 * and every call is a silent no-op, so Discord can never become a dependency for
 * launching Minecraft.
 *
 * Protocol (the same one discord-rpc / discord-rich-presence implement):
 *   frame  = u32 LE opcode | u32 LE length | JSON payload
 *   op 0   HANDSHAKE { v, client_id }            (client -> server)
 *   op 1   FRAME     commands / DISPATCH events  (both ways)
 *   op 2   CLOSE
 *   op 3   PING                                  (server -> client, must answer PONG)
 *   op 4   PONG
 *
 * Reconnection is automatic with capped exponential backoff; any failure is logged at
 * debug level and never thrown, so Rich Presence can never crash or block Noxara.
 */
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "./logger";
import { DISCORD_APP_ID } from "../../shared/constants/discord";

const APP_ID = process.env.NOXARA_DISCORD_APP_ID ?? DISCORD_APP_ID;

/** Discord exposes up to 10 pipes; apps already holding a lower one push us higher. */
const PIPE_LIMIT = 9;
const BASE_RETRY_MS = 2_000;
const MAX_RETRY_MS = 30_000;

enum Opcode {
  Handshake = 0,
  Frame = 1,
  Close = 2,
  Ping = 3,
  Pong = 4,
}

/** What we want Discord to display. Field names are intentionally Noxara-side (camel
 * case); `start` is an epoch-ms timestamp for the session elapsed clock. */
export interface DiscordActivity {
  details?: string;
  state?: string;
  /** Epoch ms the activity started — Discord renders an elapsed timer from it. */
  start?: number;
  largeImage?: string;
  largeText?: string;
}

export class DiscordRpcClient {
  private socket: net.Socket | null = null;
  private enabled = false;
  private ready = false;
  private buffer = Buffer.alloc(0);
  private retryTimer: NodeJS.Timeout | null = null;
  private retryMs = BASE_RETRY_MS;
  private pipeIndex = 0;
  /** The latest activity we were asked to show, resent on every (re)connect. */
  private currentActivity: DiscordActivity | null = null;

  /** Turns the client on/off. Disabling tears down the socket (Discord then clears the
   * presence for our pid); enabling reconnects and re-pushes the latest activity. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) {
      this.connect();
    } else {
      this.disconnect();
    }
  }

  /**
   * Updates the displayed activity. Safe to call while disconnected: the value is
   * remembered and pushed the moment a connection (or reconnection) succeeds.
   * Calling with an empty activity clears the presence.
   */
  setActivity(activity: DiscordActivity): void {
    this.currentActivity = activity;
    if (this.ready && this.socket) {
      this.sendFrame(this.socket, Opcode.Frame, this.buildSetActivity(activity));
    }
  }

  clearActivity(): void {
    this.setActivity({});
  }

  private disconnect(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }
    this.buffer = Buffer.alloc(0);
    this.ready = false;
    this.currentActivity = null;
    this.pipeIndex = 0;
  }

  private connect(): void {
    if (!this.enabled) return;
    if (!APP_ID) return;
    if (this.socket || this.retryTimer) return;

    const socket = net.createConnection(this.pipePath(this.pipeIndex));
    this.socket = socket;
    let established = false;

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
      if (this.socket === socket) this.socket = null;
      this.buffer = Buffer.alloc(0);
    };

    socket.on("connect", () => {
      established = true;
      // A live pipe — next reconnect starts from pipe 0 again.
      this.pipeIndex = 0;
      this.retryMs = BASE_RETRY_MS;
      this.ready = false;
      this.sendFrame(socket, Opcode.Handshake, { v: 1, client_id: APP_ID });
    });

    socket.on("data", (chunk: Buffer) => this.onData(chunk));

    socket.on("error", () => {
      // Couldn't connect to THIS pipe yet — Discord may be holding a higher one.
      if (!established && this.pipeIndex < PIPE_LIMIT) {
        cleanup();
        this.pipeIndex += 1;
        this.connect();
        return;
      }
      cleanup();
      this.scheduleRetry();
    });

    socket.on("close", () => {
      if (!this.enabled) return; // deliberate teardown via setEnabled(false)
      cleanup();
      this.scheduleRetry();
    });
  }

  private onData(chunk: Buffer): void {
    if (!this.socket) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const opcode = this.buffer.readUInt32LE(0);
      const length = this.buffer.readUInt32LE(4);
      if (this.buffer.length < 8 + length) return;
      const payload = this.buffer.subarray(8, 8 + length);
      this.buffer = this.buffer.subarray(8 + length);
      this.handleFrame(this.socket, opcode, payload);
    }
  }

  private handleFrame(socket: net.Socket, opcode: number, payload: Buffer): void {
    switch (opcode) {
      case Opcode.Frame: {
        let msg: { cmd?: string; evt?: string } | null = null;
        try {
          msg = JSON.parse(payload.toString("utf8"));
        } catch {
          return; // malformed frame — ignore, Discord is still fine
        }
        if (msg?.cmd === "DISPATCH" && msg.evt === "READY") {
          this.ready = true;
          if (this.currentActivity) {
            this.sendFrame(socket, Opcode.Frame, this.buildSetActivity(this.currentActivity));
          }
        }
        break;
      }
      case Opcode.Ping:
        // Echo the server's ping payload back as a PONG to keep the pipe alive.
        this.sendFrame(socket, Opcode.Pong, safeParse(payload));
        break;
      case Opcode.Close:
        if (this.enabled) this.scheduleRetry();
        break;
      default:
        break;
    }
  }

  private scheduleRetry(): void {
    if (!this.enabled || this.retryTimer) return;
    const delay = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS);
    this.pipeIndex = 0;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  private pipePath(index: number): string {
    if (process.platform === "win32") {
      return `\\\\.\\pipe\\discord-ipc-${index}`;
    }
    // Discord listens on a unix socket in $XDG_RUNTIME_DIR, falling back to /tmp.
    const runtime = process.env.XDG_RUNTIME_DIR || os.tmpdir();
    return path.join(runtime, `discord-ipc-${index}`);
  }

  private sendFrame(socket: net.Socket, opcode: Opcode, payload: unknown): void {
    if (!socket.writable) return;
    const json = Buffer.from(JSON.stringify(payload), "utf8");
    const header = Buffer.alloc(8);
    header.writeUInt32LE(opcode, 0);
    header.writeUInt32LE(json.length, 4);
    try {
      socket.write(Buffer.concat([header, json]));
    } catch (err) {
      logger.debug("[discord-rpc] failed to write frame", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private buildSetActivity(activity: DiscordActivity): unknown {
    const activityPayload: Record<string, unknown> = {};
    if (activity.state) activityPayload.state = activity.state;
    if (activity.details) activityPayload.details = activity.details;
    if (activity.start) activityPayload.timestamps = { start: activity.start };
    if (activity.largeImage || activity.largeText) {
      activityPayload.assets = {
        ...(activity.largeImage ? { large_image: activity.largeImage } : {}),
        ...(activity.largeText ? { large_text: activity.largeText } : {}),
      };
    }
    return {
      cmd: "SET_ACTIVITY",
      args: { pid: process.pid, activity: activityPayload },
      nonce: randomUUID(),
    };
  }
}

function safeParse(buffer: Buffer): unknown {
  try {
    return JSON.parse(buffer.toString("utf8"));
  } catch {
    return {};
  }
}

export const discordRpc = new DiscordRpcClient();