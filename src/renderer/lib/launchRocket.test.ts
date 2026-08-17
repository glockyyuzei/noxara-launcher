import { describe, it, expect } from "vitest";
import { nextRocketState, initialRocketState, pickLaunching, type RocketInput } from "./launchRocket";

function sets(ids: string[], running: string[] = [], crashed: string[] = [], errored: string[] = []): RocketInput {
  return {
    launching: new Set(ids),
    running: new Set(running),
    crashed: new Set(crashed),
    errored: new Set(errored),
  };
}

describe("nextRocketState", () => {
  it("starts in idle and does nothing until something is launching", () => {
    const idle = initialRocketState();
    expect(nextRocketState(idle, sets([]))).toBe(idle);
    // Already running (no launch in flight) must not summon the rocket.
    expect(nextRocketState(idle, sets([], ["a"]))).toBe(idle);
  });

  it("begins ignition when a real launch starts", () => {
    const next = nextRocketState(initialRocketState(), sets(["a"]));
    expect(next).toEqual({ instanceId: "a", phase: "ignition" });
  });

  it("ignition is not promoted to hold by lifecycle events (hold is a presentation timer)", () => {
    const ign = { instanceId: "a", phase: "ignition" as const };
    expect(nextRocketState(ign, sets(["a"]))).toBe(ign);
  });

  it("accelerates the rocket when the instance reaches running", () => {
    const hold = { instanceId: "a", phase: "hold" as const };
    expect(nextRocketState(hold, sets(["a"], ["a"]))).toEqual({ instanceId: "a", phase: "exit" });
  });

  it("fades the overlay when the instance crashes during startup", () => {
    const hold = { instanceId: "a", phase: "hold" as const };
    expect(nextRocketState(hold, sets([], [], ["a"]))).toEqual({ instanceId: "a", phase: "fade" });
  });

  it("fades the overlay when the launch failed (error state)", () => {
    const hold = { instanceId: "a", phase: "hold" as const };
    expect(nextRocketState(hold, sets([], [], [], ["a"]))).toEqual({ instanceId: "a", phase: "fade" });
  });

  it("a crash overrides an in-flight exit (game started then immediately crashed)", () => {
    const exit = { instanceId: "a", phase: "exit" as const };
    expect(nextRocketState(exit, sets([], [], ["a"]))).toEqual({ instanceId: "a", phase: "fade" });
  });

  it("fades when the instance is cleared from the launch store without running", () => {
    const hold = { instanceId: "a", phase: "hold" as const };
    expect(nextRocketState(hold, sets([]))).toEqual({ instanceId: "a", phase: "fade" });
  });

  it("keeps burning while the instance stays launching", () => {
    const hold = { instanceId: "a", phase: "hold" as const };
    expect(nextRocketState(hold, sets(["a"]))).toBe(hold);
  });

  it("picks the next launching instance after the current one finished exiting", () => {
    const finished = { instanceId: null, phase: "idle" as const };
    expect(nextRocketState(finished, sets(["b"]))).toEqual({ instanceId: "b", phase: "ignition" });
  });
});

describe("pickLaunching", () => {
  it("returns null when nothing is launching", () => {
    expect(pickLaunching(new Set())).toBeNull();
  });

  it("prefers the most recently launched instance", () => {
    const s = new Set<string>();
    s.add("first");
    s.add("second");
    expect(pickLaunching(s)).toBe("second");
  });
});