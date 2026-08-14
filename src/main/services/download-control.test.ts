import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  registerDownload,
  unregisterDownload,
  signalFor,
  hasDownload,
  listDownloadTasks,
  cancelDownload,
  retryDownload,
} from "./download-control";

describe("download-control", () => {
  beforeEach(() => {
    // The module keeps module-level maps; fresh taskIds per test keep them isolated.
    vi.restoreAllMocks();
  });

  it("exposes a live abort signal for a registered download", () => {
    registerDownload("t-1", { kind: "mod", run: async () => {} });
    const signal = signalFor("t-1");
    expect(signal).toBeDefined();
    expect(signal?.aborted).toBe(false);
    expect(hasDownload("t-1")).toBe(true);
    unregisterDownload("t-1");
    expect(hasDownload("t-1")).toBe(false);
  });

  it("lists registered tasks with their kind", () => {
    registerDownload("t-2", { kind: "content", run: async () => {} });
    registerDownload("t-3", { kind: "mod", run: async () => {} });
    const tasks = listDownloadTasks();
    expect(tasks).toEqual([
      { taskId: "t-2", kind: "content" },
      { taskId: "t-3", kind: "mod" },
    ]);
    unregisterDownload("t-2");
    unregisterDownload("t-3");
  });

  it("cancel aborts the in-flight signal so the fetch stream stops", () => {
    registerDownload("t-4", { kind: "mod", run: async () => {} });
    const signal = signalFor("t-4")!;
    expect(signal.aborted).toBe(false);
    cancelDownload("t-4");
    expect(signal.aborted).toBe(true);
    unregisterDownload("t-4");
  });

  it("cancel on an unknown task rejects with a clear error", async () => {
    await expect(cancelDownload("t-none")).rejects.toThrow("can't be cancelled");
  });

  it("retry re-runs the op under the same taskId with a fresh (unaborted) signal", async () => {
    const run = vi.fn(async () => {});
    registerDownload("t-5", { kind: "mod", run });
    // Cancel first so the old controller is aborted.
    cancelDownload("t-5");
    await retryDownload("t-5");
    expect(run).toHaveBeenCalledTimes(1);
    // After a successful retry the handles are dropped.
    expect(hasDownload("t-5")).toBe(false);
  });

  it("retry on an unknown task rejects with a clear error", async () => {
    await expect(retryDownload("t-none")).rejects.toThrow("can't be retried");
  });

  it("retry keeps handles when the op fails so the user can try again", async () => {
    const run = vi.fn(async () => {
      throw new Error("boom");
    });
    registerDownload("t-6", { kind: "mod", run });
    await expect(retryDownload("t-6")).rejects.toThrow("boom");
    expect(hasDownload("t-6")).toBe(true);
    const signal = signalFor("t-6")!;
    expect(signal.aborted).toBe(false);
    unregisterDownload("t-6");
  });

  it("unregister aborts a still-streaming op as a safety net", () => {
    registerDownload("t-7", { kind: "content", run: async () => {} });
    const signal = signalFor("t-7")!;
    unregisterDownload("t-7");
    expect(signal.aborted).toBe(true);
  });
});