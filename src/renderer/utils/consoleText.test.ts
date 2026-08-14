import { describe, it, expect } from "vitest";
import { stripAnsi } from "./consoleText";

describe("stripAnsi", () => {
  it("removes SGR color codes", () => {
    expect(stripAnsi("\x1b[31mERROR\x1b[0m")).toBe("ERROR");
  });

  it("removes multi-parameter codes (24-bit colors)", () => {
    expect(stripAnsi("\x1b[38;2;255;0;0mred\x1b[0m")).toBe("red");
  });

  it("removes cursor/erase sequences", () => {
    expect(stripAnsi("\x1b[2J\x1b[3;5Hheader")).toBe("header");
  });

  it("removes OSC sequences (window title / hyperlink)", () => {
    expect(stripAnsi("\x1b]0;title\x07payload")).toBe("payload");
    expect(stripAnsi("\x1b]8;;https://example.com\x07link\x1b]8;;\x07")).toBe("link");
  });

  it("strips stray control bytes but keeps normal text and tabs", () => {
    expect(stripAnsi("a\x07b")).toBe("ab");
    expect(stripAnsi("left\tright")).toBe("left\tright");
  });

  it("leaves ordinary lines untouched", () => {
    expect(stripAnsi("[15:42:01] [Render thread/INFO]: Done (2.100s)!")).toBe(
      "[15:42:01] [Render thread/INFO]: Done (2.100s)!"
    );
  });

  it("handles non-ASCII and HTML-looking text without touching it (React escapes it later)", () => {
    const line = "<script>alert(1)</script> hej världen ✓";
    expect(stripAnsi(line)).toBe(line);
  });

  it("handles malformed / unterminated escape sequences without crashing", () => {
    // The ESC byte is removed; a truncated sequence's trailing chars stay visible.
    expect(stripAnsi("oops\x1b[31")).toBe("oops[31");
    expect(stripAnsi("\x1b[")).toBe("[");
    expect(stripAnsi("trailing\x1b")).toBe("trailing");
  });

  it("handles a long spammy line (2000+ chars) quickly", () => {
    const line = `\x1b[34m${"x".repeat(3000)}\x1b[0m`;
    const result = stripAnsi(line);
    expect(result).toBe("x".repeat(3000));
    expect(result.length).toBe(3000);
  });
});