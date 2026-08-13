import { describe, it, expect } from "vitest";
import { deriveInstanceState } from "./useInstanceState";

type Input = Parameters<typeof deriveInstanceState>[0];
const none: Input = { launching: false, running: false, stopping: false, crashed: false, errored: false, active: [] };

describe("deriveInstanceState", () => {
  it("reports READY with no signals at all", () => {
    expect(deriveInstanceState(none)).toBe("READY");
  });

  it("an in-flight kill always wins (STOPPING beats RUNNING)", () => {
    expect(deriveInstanceState({ ...none, running: true, stopping: true })).toBe("STOPPING");
    expect(deriveInstanceState({ ...none, active: [{ status: "stopping" }] })).toBe("STOPPING");
  });

  it("RUNNING outranks a crash report", () => {
    expect(deriveInstanceState({ ...none, running: true, crashed: true })).toBe("RUNNING");
  });

  it("CRASHED outranks a pending launch", () => {
    expect(deriveInstanceState({ ...none, launching: true, crashed: true })).toBe("CRASHED");
  });

  it("ERROR outranks LAUNCHING", () => {
    expect(deriveInstanceState({ ...none, launching: true, errored: true })).toBe("ERROR");
  });

  it("maps creating/preparing activities to CREATING", () => {
    expect(deriveInstanceState({ ...none, active: [{ status: "preparing" }] })).toBe("CREATING");
  });

  it("maps downloading/verifying activities to DOWNLOADING", () => {
    expect(deriveInstanceState({ ...none, active: [{ status: "downloading" }] })).toBe("DOWNLOADING");
  });

  it("maps installing/importing/repairing activities to INSTALLING", () => {
    expect(deriveInstanceState({ ...none, active: [{ status: "repairing" }] })).toBe("INSTALLING");
  });

  it("maps a launching activity to LAUNCHING", () => {
    expect(deriveInstanceState({ ...none, active: [{ status: "launching" }] })).toBe("LAUNCHING");
  });
});