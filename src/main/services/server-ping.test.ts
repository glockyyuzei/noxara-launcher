import { afterEach, describe, expect, it } from "vitest";
import net from "node:net";
import { pingServer } from "./server-ping";

const servers: net.Server[] = [];
const sockets: net.Socket[] = [];

function startServer(onConnection: (socket: net.Socket) => void): Promise<{ port: number; server: net.Server }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      // Swallow client-side disconnects (ECONNABORTED on late writes) — normal when
      // the probe settles and destroys the socket before the mock finishes writing.
      socket.on("error", () => {});
      sockets.push(socket);
      onConnection(socket);
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      servers.push(server);
      resolve({ port: addr.port, server });
    });
  });
}

afterEach(() => {
  for (const s of sockets) s.destroy();
  sockets.length = 0;
  for (const s of servers) s.close();
  servers.length = 0;
});

/** A tiny client-side VarInt encoder to build server responses. */
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

function frame(packetId: number, payload: Buffer): Buffer {
  const inner = Buffer.concat([writeVarInt(packetId), payload]);
  return Buffer.concat([writeVarInt(inner.length), inner]);
}

const STATUS_JSON = JSON.stringify({
  version: { name: "Paper 1.21.1", protocol: 767 },
  players: { online: 3, max: 20 },
  description: { text: "Hello", extra: [{ text: " World" }] },
  favicon: "data:image/png;base64,AA==",
});

function handshakeFrame(): Buffer {
  // Response frame: status packet id 0x00, then VarInt string length, then the JSON.
  const json = Buffer.from(STATUS_JSON, "utf8");
  return frame(0x00, Buffer.concat([writeVarInt(json.length), json]));
}

function pongFrame(): Buffer {
  return frame(0x01, Buffer.alloc(8));
}

describe("pingServer", () => {
  it("resolves online with parsed status after a full handshake + ping round-trip", async () => {
    let sawStatus = false;
    const { port } = await startServer((socket) => {
      socket.on("data", () => {
        // Client writes handshake then status request; respond with a status frame,
        // then on the ping request respond with the pong frame.
        if (!sawStatus) {
          socket.write(handshakeFrame());
          sawStatus = true;
        } else {
          socket.write(pongFrame());
        }
      });
    });

    const result = await pingServer("127.0.0.1", port, 2000);
    expect(result.online).toBe(true);
    expect(result.versionName).toBe("Paper 1.21.1");
    expect(result.protocol).toBe(767);
    expect(result.playersOnline).toBe(3);
    expect(result.playersMax).toBe(20);
    expect(result.description).toBe("Hello World");
    expect(result.favicon).toBe("data:image/png;base64,AA==");
    expect(typeof result.latencyMs).toBe("number");
  });

  it("resolves online with null latency when the server never pongs", async () => {
    const { port } = await startServer((socket) => {
      socket.on("data", () => socket.write(handshakeFrame())); // never pong
    });

    const result = await pingServer("127.0.0.1", port, 3000);
    expect(result.online).toBe(true);
    expect(result.latencyMs).toBeNull();
    expect(result.description).toBe("Hello World");
  });

  it("resolves offline when the server sends garbage instead of JSON", async () => {
    const { port } = await startServer((socket) => {
      socket.on("data", () => {
        // Valid frame shape, but the payload string is not JSON.
        const junk = Buffer.from("not-json-at-all", "utf8");
        socket.write(frame(0x00, Buffer.concat([writeVarInt(junk.length), junk])));
      });
    });

    const result = await pingServer("127.0.0.1", port, 2000);
    expect(result.online).toBe(false);
  });

  it("resolves offline when the connection times out with no data", async () => {
    const { port } = await startServer(() => {
      // Accept the connection and never respond.
    });

    const result = await pingServer("127.0.0.1", port, 300);
    expect(result.online).toBe(false);
    expect(result.latencyMs).toBeNull();
  });

  it("resolves offline when the port is closed (connection refused)", async () => {
    // Grab a port from an ephemeral server, then close it so nothing listens.
    const { port, server } = await startServer(() => {});
    await new Promise((resolve) => server.close(resolve));

    const result = await pingServer("127.0.0.1", port, 2000);
    expect(result.online).toBe(false);
  });

  it("does not resolve twice (single settlement) when server floods frames", async () => {
    let resolves = 0;
    const { port } = await startServer((socket) => {
      socket.on("data", () => {
        socket.write(handshakeFrame());
        socket.write(pongFrame());
        socket.write(handshakeFrame());
        socket.write(pongFrame());
      });
    });

    const result = await pingServer("127.0.0.1", port, 2000);
    expect(result.online).toBe(true);
    resolves += 1;
    await new Promise((r) => setTimeout(r, 100));
    expect(resolves).toBe(1);
  });
});
