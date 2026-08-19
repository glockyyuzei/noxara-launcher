/**
 * Rich Presence controller: translates the real Noxara/Minecraft lifecycle into the
 * activity shown on Discord. This is the ONLY module that decides what presence to
 * push — the renderer never talks to Discord directly.
 *
 * The lifecycle is the single source of truth:
 *   Noxara starts            -> launcher presence
 *   user launches an instance -> "Launching Minecraft"
 *   core reports game.started -> "Playing Minecraft" (elapsed timer from that moment)
 *   core reports game.exit    -> back to launcher presence
 *
 * Which server the player is on is tracked LIVE from the game's own console output
 * (see parseServerConnect / isServerDisconnect), not just the `--server` launch arg.
 * That way presence is accurate no matter how the user launched: from the Servers
 * page, an instance page, or by joining a server from inside the game. When several
 * instances run at once we show the most recently started running one, so concurrent
 * sessions can't fight over the activity. Everything here is best-effort and never
 * throws: if Discord is missing, disabled, or disconnected, the controller just keeps
 * the state bookkeeping and silently skips the network calls.
 */
import { discordRpc, type DiscordActivity } from "./discord-rpc";

/** The slice of the Discord client the controller needs — injected so tests can use a
 * fake instead of touching a real socket. */
export interface PresenceTarget {
  setEnabled(enabled: boolean): void;
  setActivity(activity: DiscordActivity): void;
}

/** Non-secret info we already know about a launch, used to describe it on Discord. */
export interface LaunchSessionInfo {
  instanceName: string;
  minecraftVersion: string;
  loader: string;
  /** Resolved from the `--server` game arg when the user joined a server on launch. */
  server?: string;
}

interface RunningSession {
  instanceId: string;
  info: LaunchSessionInfo;
  /** Epoch ms the JVM actually came up (game.started) — the real session start. */
  startedAt: number;
}

/** Discord application asset key for the large image. Documented in the README. */
const NOXARA_ASSET = "noxara_logo";

export class PresenceController {
  private enabled = false;
  private launching: { instanceId: string; info: LaunchSessionInfo } | null = null;
  private sessions = new Map<string, RunningSession>();
  /** Live "currently playing on" override keyed by instance id. A `null` value means the
   * player is explicitly back in singleplayer, which masks a launch-time `--server`. */
  private serverOverride = new Map<string, string | null>();

  constructor(private target: PresenceTarget = discordRpc) {}

  /** Enables presence and immediately pushes whatever activity is correct now. */
  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.target.setEnabled(true);
    this.refresh();
  }

  /** Disables presence and drops the Discord connection (presence clears on the pipe
   * closing). Session bookkeeping survives so re-enabling restores the right state. */
  stop(): void {
    this.enabled = false;
    this.target.setEnabled(false);
  }

  /** A real launch pipeline started for an instance. */
  onLaunchStart(instanceId: string, info: LaunchSessionInfo): void {
    this.launching = { instanceId, info };
    this.refresh();
  }

  /** The launch pipeline failed before the JVM ever came up. */
  onLaunchFailed(instanceId: string): void {
    if (this.launching?.instanceId === instanceId) {
      this.launching = null;
      this.refresh();
    }
  }

  /** The core reported the Minecraft JVM actually started. */
  onGameStarted(instanceId: string): void {
    const info =
      this.launching?.instanceId === instanceId
        ? this.launching.info
        : this.sessions.get(instanceId)?.info;
    if (this.launching?.instanceId === instanceId) this.launching = null;
    this.sessions.set(instanceId, {
      instanceId,
      info: info ?? { instanceName: "Minecraft", minecraftVersion: "", loader: "" },
      startedAt: Date.now(),
    });
    this.refresh();
  }

  /** Game output reported the player connected to a server. `server` is the display
   * string to show (caller resolves the saved server's name, falling back to its
   * address). Safe to call before/after game.started — ordering doesn't matter. */
  onServerConnected(instanceId: string, server: string): void {
    if (!server || this.serverOverride.get(instanceId) === server) return;
    this.serverOverride.set(instanceId, server);
    this.refresh();
  }

  /** Game output reported the player left the server (disconnect, or a singleplayer
   * world loaded). Masks a launch-time `--server` so presence returns to Singleplayer. */
  onServerDisconnected(instanceId: string): void {
    if (this.serverOverride.get(instanceId) === null) return;
    this.serverOverride.set(instanceId, null);
    this.refresh();
  }

  /** Minecraft exited — return to the launcher presence (or another running session). */
  onGameExited(instanceId: string): void {
    this.sessions.delete(instanceId);
    this.serverOverride.delete(instanceId);
    if (this.launching?.instanceId === instanceId) this.launching = null;
    this.refresh();
  }

  private refresh(): void {
    if (!this.enabled) return;
    const activity = this.computeActivity();
    if (!activity) return;
    this.target.setActivity(activity);
  }

  private computeActivity(): DiscordActivity | null {
    if (this.launching) return this.launchingActivity(this.launching);
    const running = [...this.sessions.values()].sort((a, b) => b.startedAt - a.startedAt);
    if (running.length > 0) return this.playingActivity(running[0]);
    return this.launcherActivity();
  }

  private launcherActivity(): DiscordActivity {
    return {
      details: "Managing Minecraft instances",
      state: "Minecraft Launcher",
      largeImage: NOXARA_ASSET,
      largeText: "Noxara Launcher",
    };
  }

  private launchingActivity(launch: { instanceId: string; info: LaunchSessionInfo }): DiscordActivity {
    return {
      details: "Launching Minecraft",
      state: launch.info.instanceName,
      largeImage: NOXARA_ASSET,
      largeText: "Noxara Launcher",
    };
  }

  private playingActivity(session: RunningSession): DiscordActivity {
    const server = this.currentServer(session);
    const activity: DiscordActivity = {
      details: "Playing Minecraft",
      state: server ? `Playing on ${server}` : "Singleplayer",
      start: session.startedAt,
      largeImage: NOXARA_ASSET,
      largeText: "Noxara Launcher",
    };
    return activity;
  }

  /** The server to display for a session: the live override wins (a live connect beat
   * the launch args, an explicit null means singleplayer), otherwise the launch-time
   * `--server` address. */
  private currentServer(session: RunningSession): string | undefined {
    if (this.serverOverride.has(session.instanceId)) {
      return this.serverOverride.get(session.instanceId) ?? undefined;
    }
    return session.info.server;
  }
}

export const presence = new PresenceController();

/** Parses the `--server` address out of the extra game args the renderer passes on a
 * server launch (ServersPage appends `--server <address> [--port <port>]`). Returns
 * undefined when the user launched plain singleplayer. */
export function extractServerAddress(extraGameArgs?: string[]): string | undefined {
  if (!extraGameArgs) return undefined;
  const index = extraGameArgs.indexOf("--server");
  const address = index >= 0 ? extraGameArgs[index + 1] : undefined;
  return address && address.trim() ? address.trim() : undefined;
}

/** A target parsed out of the game's own console output when it connects to a server. */
export interface ServerTarget {
  address: string;
  port: number;
}

/** Matches Minecraft's client log line for connecting to a server. Both formats the
 * game uses across versions:
 *   [Netty Client IO #1/INFO]: Connecting to play.hypixel.net, 25565      (<= 1.19.2)
 *   [Netty Client IO #1/INFO]: Connecting to play.hypixel.net:25565       (1.19.3+)
 *   [Netty Client IO #0/INFO]: Connecting to host "play.hypixel.net"      (quoted form)
 */
const CONNECT_RE = /Connecting to (?:host )?(.+)$/i;

export function parseServerConnect(line: string): ServerTarget | null {
  const match = line.match(CONNECT_RE);
  if (!match) return null;
  // Strip surrounding quotes/brackets handled below; trim accidental whitespace.
  const raw = match[1].trim().replace(/^["']|["']$/g, "").trim();
  if (!raw) return null;

  // IPv6 bracket form: [2001:db8::1]:25565
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    if (end > 1) {
      const port = parseTrailingPort(raw.slice(end + 1));
      return { address: raw.slice(1, end), port };
    }
    return null;
  }

  const colon = raw.lastIndexOf(":");
  if (colon > 0) {
    const port = parsePort(raw.slice(colon + 1));
    if (port !== null) return { address: raw.slice(0, colon), port };
  }

  // Comma form: play.hypixel.net, 25565
  const comma = raw.indexOf(",");
  if (comma > 0) {
    const port = parsePort(raw.slice(comma + 1).trim());
    if (port !== null) return { address: raw.slice(0, comma).trim(), port };
  }

  return { address: raw, port: 25565 };
}

function parseTrailingPort(rest: string): number {
  const match = rest.match(/^:(\d{1,5})$/);
  return match ? Number(match[1]) : 25565;
}

function parsePort(value: string): number | null {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null;
}

/** True when a game log line means the player is no longer on a multiplayer server:
 * a dropped/kicked connection, or a singleplayer world loading up (the integrated
 * server starting). Returning to the title screen or another server is handled by the
 * next connect/startup line, so these are best-effort clear signals. */
export function isServerDisconnect(line: string): boolean {
  return /Connection lost|Disconnected from|Starting integrated minecraft server/i.test(line);
}