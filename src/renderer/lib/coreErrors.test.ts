import { describe, it, expect } from "vitest";
import { friendlyCoreError } from "./coreErrors";

describe("friendlyCoreError", () => {
  it("classifies bridge timeouts as retryable", () => {
    const f = friendlyCoreError(
      new Error('The "fabric.getLoaderVersions" request did not respond in time (after 30s).')
    );
    expect(f.title).toContain("timed out");
    expect(f.retryable).toBe(true);
  });

  it("classifies network failures as retryable", () => {
    const f = friendlyCoreError(new Error("fetch failed: getaddrinfo ENOTFOUND api.modrinth.com"));
    expect(f.title).toContain("Network problem");
    expect(f.retryable).toBe(true);
  });

  it("classifies cancellations", () => {
    const f = friendlyCoreError(new Error("download cancelled"));
    expect(f.title).toBe("Cancelled");
  });

  it("falls back to a generic, non-retryable message for unknown errors", () => {
    const f = friendlyCoreError(new Error("something entirely unexpected"));
    expect(f.title).toBe("Something went wrong");
    expect(f.retryable).toBe(false);
  });
});
