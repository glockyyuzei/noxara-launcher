import { describe, it, expect, beforeEach } from "vitest";
import {
  PresenceController,
  extractServerAddress,
  isServerDisconnect,
  parseServerConnect,
  type PresenceTarget,
} from "./presence";
import type { DiscordActivity } from "./discord-rpc";

class FakeTarget implements PresenceTarget {
  enabled = false;
  activities: DiscordActivity[] = [];

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setActivity(activity: DiscordActivity): void {
    this.activities.push(activity);
  }

  get last(): DiscordActivity | undefined {
    return this.activities[this.activities.length - 1];
  }

  get calls(): number {
    return this.activities.length;
  }
}

function info(overrides: Partial<Record<"instanceName" | "server", string>> = {}) {
  return {
    instanceName: "Hermitcraft",
    minecraftVersion: "1.21",
    loader: "vanilla",
    ...overrides,
  };
}

describe("PresenceController", () => {
  let target: FakeTarget;
  let presence: PresenceController;

  beforeEach(() => {
    target = new FakeTarget();
    presence = new PresenceController(target);
  });

  it("is inert until started (no Discord calls)", () => {
    presence.onLaunchStart("a", info());
    expect(target.calls).toBe(0);
  });

  it("shows the launcher activity once started", () => {
    presence.start();
    expect(target.enabled).toBe(true);
    expect(target.last).toEqual({
      details: "Managing Minecraft instances",
      state: "Minecraft Launcher",
      largeImage: "noxara_logo",
      largeText: "Noxara Launcher",
    });
  });

  it("shows a launching activity while the pipeline runs", () => {
    presence.start();
    presence.onLaunchStart("a", info());
    expect(target.last?.details).toBe("Launching Minecraft");
    expect(target.last?.state).toBe("Hermitcraft");
  });

  it("shows Singleplayer once the game actually starts", () => {
    presence.start();
    presence.onLaunchStart("a", info());
    presence.onGameStarted("a");
    expect(target.last?.details).toBe("Playing Minecraft");
    expect(target.last?.state).toBe("Singleplayer");
    expect(typeof target.last?.start).toBe("number");
  });

  it("shows the joined server for a server launch", () => {
    presence.start();
    presence.onLaunchStart("a", info({ server: "play.hypixel.net" }));
    presence.onGameStarted("a");
    expect(target.last?.state).toBe("Playing on play.hypixel.net");
  });

  it("clears the launching state when the launch pipeline fails", () => {
    presence.start();
    presence.onLaunchStart("a", info());
    presence.onLaunchFailed("a");
    expect(target.last?.details).toBe("Managing Minecraft instances");
  });

  it("ignores a launch failure for a different instance", () => {
    presence.start();
    presence.onLaunchStart("a", info());
    presence.onLaunchFailed("b");
    expect(target.last?.details).toBe("Launching Minecraft");
  });

  it("prefers the most recently started running session", () => {
    presence.start();
    presence.onLaunchStart("a", info());
    presence.onGameStarted("a");
    presence.onLaunchStart("b", info());
    presence.onGameStarted("b");
    expect(target.last?.state).toBe("Singleplayer");
    const first = target.activities[target.activities.length - 2];
    const second = target.last;
    expect((second?.start ?? 0)).toBeGreaterThanOrEqual(first?.start ?? 0);
  });

  it("returns to the remaining session when one game exits", () => {
    presence.start();
    presence.onLaunchStart("a", info());
    presence.onGameStarted("a");
    presence.onLaunchStart("b", info());
    presence.onGameStarted("b");
    presence.onGameExited("b");
    expect(target.last?.state).toBe("Singleplayer");
  });

  it("returns to the launcher activity when the last game exits", () => {
    presence.start();
    presence.onLaunchStart("a", info());
    presence.onGameStarted("a");
    presence.onGameExited("a");
    expect(target.last?.details).toBe("Managing Minecraft instances");
  });

  it("switches to the joined server when the game reports a connect", () => {
    presence.start();
    presence.onLaunchStart("a", info());
    presence.onGameStarted("a");
    expect(target.last?.state).toBe("Singleplayer");
    presence.onServerConnected("a", "Hypixel");
    expect(target.last?.state).toBe("Playing on Hypixel");
  });

  it("accepts a server connect even before game.started lands", () => {
    presence.start();
    presence.onServerConnected("a", "Hypixel");
    presence.onLaunchStart("a", info());
    presence.onGameStarted("a");
    expect(target.last?.state).toBe("Playing on Hypixel");
  });

  it("returns to Singleplayer when the player leaves the server", () => {
    presence.start();
    presence.onLaunchStart("a", info());
    presence.onGameStarted("a");
    presence.onServerConnected("a", "Hypixel");
    presence.onServerDisconnected("a");
    expect(target.last?.state).toBe("Singleplayer");
  });

  it("masks a launch-time --server when the player disconnects into singleplayer", () => {
    presence.start();
    presence.onLaunchStart("a", info({ server: "play.hypixel.net" }));
    presence.onGameStarted("a");
    expect(target.last?.state).toBe("Playing on play.hypixel.net");
    presence.onServerDisconnected("a");
    expect(target.last?.state).toBe("Singleplayer");
  });

  it("clears the server override when the game exits", () => {
    presence.start();
    presence.onLaunchStart("a", info());
    presence.onGameStarted("a");
    presence.onServerConnected("a", "Hypixel");
    presence.onGameExited("a");
    presence.onGameStarted("a");
    expect(target.last?.state).toBe("Singleplayer");
  });

  it("stops pushing activities when disabled", () => {
    presence.start();
    presence.stop();
    expect(target.enabled).toBe(false);
    const calls = target.calls;
    presence.onLaunchStart("a", info());
    expect(target.calls).toBe(calls);
  });

  it("keeps bookkeeping across stop so re-enabling restores the right state", () => {
    presence.start();
    presence.onLaunchStart("a", info());
    presence.onGameStarted("a");
    presence.stop();
    presence.start();
    expect(target.last?.details).toBe("Playing Minecraft");
    expect(target.last?.state).toBe("Singleplayer");
  });
});

describe("extractServerAddress", () => {
  it("returns the address for a server launch", () => {
    expect(extractServerAddress(["--server", "play.hypixel.net"])).toBe("play.hypixel.net");
  });

  it("returns the address even when a port follows", () => {
    expect(extractServerAddress(["--server", "mc.example.com", "--port", "25565"])).toBe(
      "mc.example.com"
    );
  });

  it("returns undefined for singleplayer", () => {
    expect(extractServerAddress(undefined)).toBeUndefined();
    expect(extractServerAddress([])).toBeUndefined();
    expect(extractServerAddress(["--fast", "--memory", "4G"])).toBeUndefined();
  });

  it("returns undefined when the address is blank", () => {
    expect(extractServerAddress(["--server", " "])).toBeUndefined();
  });
});

describe("parseServerConnect", () => {
  it("parses the classic comma form (<= 1.19.2)", () => {
    expect(parseServerConnect("[13:45:06] [Netty Client IO #1/INFO]: Connecting to play.hypixel.net, 25565")).toEqual({
      address: "play.hypixel.net",
      port: 25565,
    });
  });

  it("parses the colon form (1.19.3+)", () => {
    expect(parseServerConnect("[13:45:06] [Netty Client IO #1/INFO]: Connecting to mc.example.com:25577")).toEqual({
      address: "mc.example.com",
      port: 25577,
    });
  });

  it("parses the quoted host form with a default port", () => {
    expect(parseServerConnect("[13:45:06] [Netty Client IO #0/INFO]: Connecting to host \"play.hypixel.net\"")).toEqual({
      address: "play.hypixel.net",
      port: 25565,
    });
  });

  it("parses bracketed IPv6 addresses", () => {
    expect(parseServerConnect("Connecting to host \"[2001:db8::1]:25565\"")).toEqual({
      address: "2001:db8::1",
      port: 25565,
    });
  });

  it("returns null for non-connecting lines", () => {
    expect(parseServerConnect("Connected to play.hypixel.net:25565")).toBeNull();
    expect(parseServerConnect("[Server thread/INFO]: Starting integrated minecraft server version 1.21")).toBeNull();
    expect(parseServerConnect("")).toBeNull();
  });
});

describe("isServerDisconnect", () => {
  it("detects a dropped connection", () => {
    expect(isServerDisconnect("[Netty Client IO #1/WARN]: Connection lost, no further messages")).toBe(true);
  });

  it("detects a singleplayer world load", () => {
    expect(isServerDisconnect("[Server thread/INFO]: Starting integrated minecraft server version 1.21")).toBe(true);
  });

  it("ignores ordinary output", () => {
    expect(isServerDisconnect("[Server thread/INFO]: Done (4.832s)! For help, type \"help\"")).toBe(false);
    expect(isServerDisconnect("")).toBe(false);
  });
});
