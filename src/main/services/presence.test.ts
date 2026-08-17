import { describe, it, expect, beforeEach } from "vitest";
import { PresenceController, extractServerAddress, type PresenceTarget } from "./presence";
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
