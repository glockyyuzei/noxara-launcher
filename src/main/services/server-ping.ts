/**
 * Minecraft Server List Ping (the classic server status probe). Uses raw TCP — no
 * third-party deps — to speak just enough of the modern protocol: a handshake request
 * (protocol 767, status intent), a status request, and finally a ping that measures
 * round-trip latency. Servers that never answer a ping still resolve with their status
 * (latencyMs stays null).
 *
 * Run in the main process only; the renderer never opens sockets, per the security
 * model. `address` here is validated host/IP only (never a shell string), and ports
 * are bounded by the renderer's Server editor.
 */
import net from "node:net";
import type { ServerPingResult } from "../../shared/types/ipc";

const PROTOCOL_VERSION = 767; // Minecraft 1.21.x — universally status-compatible
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

function writeVarInt(value: number): Buffer {
  const out: number[] = [];
  let v = value >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return Buffer.from(out);
}

/** Reads a VarInt at `offset`; returns null when the buffer is incomplete there. */
function readVarInt(buf: Buffer, offset: number): { value: number; bytes: number } | null {
  let result = 0;
  let shift = 0;
  let i = offset;
  let b: number;
  while (true) {
    b = buf[i];
    if (b === undefined) return null;
    result |= (b & 0x7f) << shift;
    shift += 7;
    i += 1;
    if ((b & 0x80) === 0) break;
    if (shift > 35) throw new Error("Malformed VarInt in server response");
  }
  return { value: result >>> 0, bytes: i - offset };
}

/** Flattens a chat component (plain string, object tree, or array) into readable text. */
function renderText(component: unknown): string {
  if (typeof component === "string") return component;
  if (Array.isArray(component)) return component.map(renderText).join("");
  if (component && typeof component === "object") {
    const c = component as Record<string, unknown>;
    let out = typeof c.text === "string" ? c.text : "";
    if (Array.isArray(c.extra)) out += renderText(c.extra);
    if (Array.isArray(c.with)) out += renderText(c.with);
    return out;
  }
  return "";
}

export function pingServer(address: string, port: number, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ServerPingResult> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: address, port });
    socket.setNoDelay(true);

    let buffer = Buffer.alloc(0);
    let settled = false;
    let statusJson: string | null = null;
    let pingStart = 0;
    let pingTimer: NodeJS.Timeout | null = null;

    const fail = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pingTimer) clearTimeout(pingTimer);
      socket.destroy();
      resolve({ online: false, latencyMs: null, versionName: null, protocol: null, playersOnline: null, playersMax: null, description: null, favicon: null });
    };

    const succeed = (latency: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (pingTimer) clearTimeout(pingTimer);
      socket.destroy();

      let data: any = null;
      try {
        data = statusJson ? JSON.parse(statusJson) : null;
      } catch {
        data = null;
      }
      if (!data) {
        fail();
        return;
      }
      resolve({
        online: true,
        latencyMs: latency,
        versionName: typeof data.version?.name === "string" ? data.version.name : null,
        protocol: typeof data.version?.protocol === "number" ? data.version.protocol : null,
        playersOnline: typeof data.players?.online === "number" ? data.players.online : null,
        playersMax: typeof data.players?.max === "number" ? data.players.max : null,
        description: data.description != null ? renderText(data.description).slice(0, 512) || null : null,
        favicon: typeof data.favicon === "string" ? data.favicon : null,
      });
    };

    const timer = setTimeout(fail, timeoutMs);
    socket.on("error", fail);
    socket.on("timeout", fail);

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > MAX_RESPONSE_BYTES) {
        fail();
        return;
      }
      try {
        while (!settled) {
          // Frame = [VarInt length][packet id VarInt][payload]
          const lenInfo = readVarInt(buffer, 0);
          if (!lenInfo || buffer.length < lenInfo.bytes + lenInfo.value) break;
          const frameLen = lenInfo.value;
          const idInfo = readVarInt(buffer, lenInfo.bytes);
          if (!idInfo) break;
          const payloadStart = lenInfo.bytes + idInfo.bytes;
          const payload = buffer.subarray(payloadStart, lenInfo.bytes + frameLen);
          buffer = buffer.subarray(lenInfo.bytes + frameLen);

          if (idInfo.value === 0x00) {
            const sLen = readVarInt(payload, 0);
            if (!sLen || sLen.bytes + sLen.value > payload.length) continue;
            statusJson = payload.subarray(sLen.bytes, sLen.bytes + sLen.value).toString("utf8");
            // Send a ping request to measure latency.
            const timeBuf = Buffer.alloc(8);
            timeBuf.writeBigUInt64BE(BigInt(Date.now()), 0);
            const pingPacket = Buffer.concat([writeVarInt(0x01), timeBuf]);
            socket.write(Buffer.concat([writeVarInt(pingPacket.length), pingPacket]));
            pingStart = Date.now();
            pingTimer = setTimeout(() => succeed(null), Math.min(2500, timeoutMs));
          } else if (idInfo.value === 0x01) {
            succeed(pingStart ? Math.max(0, Date.now() - pingStart) : null);
          }
        }
      } catch {
        fail();
      }
    });

    // Handshake: 0x00 | protocol VarInt | host string | unsigned short port | 1 (status)
    const hostBuf = Buffer.from(address, "utf8");
    const handshake = Buffer.concat([
      writeVarInt(0x00),
      writeVarInt(PROTOCOL_VERSION),
      writeVarInt(hostBuf.length),
      hostBuf,
      Buffer.from([(port >> 8) & 0xff, port & 0xff]),
      writeVarInt(0x01),
    ]);
    socket.write(Buffer.concat([writeVarInt(handshake.length), handshake]));
    // Status request: packet id 0x00, empty payload → frame "length 1, byte 0".
    socket.write(Buffer.concat([writeVarInt(1), writeVarInt(0x00)]));
  });
}