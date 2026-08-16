import { describe, it, expect } from "vitest";
import { scrub } from "./logger";

// Internal helper is exported for testing the secret backstop in isolation.
describe("logger scrub", () => {
  it("redacts keys matching secret patterns at any depth", () => {
    const ctx = {
      taskId: "abc",
      username: "steve",
      access_token: "live.t0ken",
      account: { accessToken: "t", device_code: "d", userCode: "u", xsts_token: "x" },
      items: [{ authorization: "Bearer z" }],
    };
    const out = scrub(ctx) as typeof ctx;
    expect(out.taskId).toBe("abc");
    expect(out.username).toBe("steve");
    expect(out.access_token).toBe("[REDACTED]");
    expect(out.account.accessToken).toBe("[REDACTED]");
    expect(out.account.device_code).toBe("[REDACTED]");
    expect(out.account.userCode).toBe("[REDACTED]");
    expect(out.account.xsts_token).toBe("[REDACTED]");
    expect((out.items[0] as { authorization: string }).authorization).toBe("[REDACTED]");
  });

  it("leaves plain context untouched", () => {
    const ctx = { instanceId: "i1", bytesDownloaded: 1234, progress: 0.5 };
    expect(scrub(ctx)).toEqual(ctx);
  });

  it("handles primitives and arrays", () => {
    expect(scrub("plain")).toBe("plain");
    expect(scrub(42)).toBe(42);
    expect(scrub([1, 2])).toEqual([1, 2]);
    expect(scrub(null)).toBeNull();
  });
});
