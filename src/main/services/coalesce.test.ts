import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createProgressCoalescer } from "./coalesce";

describe("createProgressCoalescer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits immediately on the first push", () => {
    const emit = vi.fn();
    const c = createProgressCoalescer(emit, 75);
    c.push(100, 1000);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenLastCalledWith(100, 1000);
  });

  it("coalesces rapid pushes within the interval", () => {
    const emit = vi.fn();
    const c = createProgressCoalescer(emit, 75);
    c.push(10, 1000);
    c.push(20, 1000);
    c.push(30, 1000);
    // Only the first (immediate) emission happened so far; the trailing edge is pending.
    expect(emit).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(emit).toHaveBeenCalledTimes(2);
    // The trailing edge delivers the LATEST byte count, not an intermediate one.
    expect(emit).toHaveBeenLastCalledWith(30, 1000);
  });

  it("emits again once the interval has elapsed", () => {
    const emit = vi.fn();
    const c = createProgressCoalescer(emit, 75);
    c.push(10, 1000);
    vi.advanceTimersByTime(100);
    c.push(20, 1000);
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith(20, 1000);
  });

  it("flush always delivers the latest value immediately", () => {
    const emit = vi.fn();
    const c = createProgressCoalescer(emit, 75);
    c.push(10, 1000);
    c.push(1000, 1000);
    expect(emit).toHaveBeenCalledTimes(1);
    c.flush();
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith(1000, 1000);
  });

  it("flush with no pending timer still delivers the current state", () => {
    const emit = vi.fn();
    const c = createProgressCoalescer(emit, 75);
    c.push(10, 1000);
    expect(emit).toHaveBeenCalledTimes(1);
    c.flush();
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith(10, 1000);
  });
});