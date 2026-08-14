/**
 * Console-line text sanitization for the in-app console.
 *
 * The console is rendered as plain React text (no dangerouslySetInnerHTML), so
 * arbitrary Minecraft/mod output can never become HTML. The one remaining issue
 * is cosmetic: some loaders/mod tools (and the JVM banner) emit ANSI escape
 * sequences that otherwise show up as raw garbage characters like `[0m`/`[31m`.
 * We strip them for display only — the stored line is never modified.
 */

// CSI (ESC [) sequences: colors, cursor movement, erase, etc.
const ANSI_CSI = /\x1b\[[0-9;?]*[ -\/]*[@-~]/g;
// OSC (ESC ]) sequences: window titles, hyperlinks, etc.
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
// Other single-byte escapes (BEL, backspace, etc.) that only add noise.
const ANSI_OTHER = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

/** Strips ANSI/VT escape sequences so a Minecraft line displays cleanly. */
export function stripAnsi(line: string): string {
  return line.replace(ANSI_OSC, "").replace(ANSI_CSI, "").replace(ANSI_OTHER, "");
}