/**
 * Shared RAM-limit policy for the Minecraft JVM heap, used by both the main-process
 * validation (instances.ts) and the renderer's inline UI checks so the two can never
 * disagree.
 *
 * The JVM gets at most 75% of the system's total memory, and never more than
 * (total - 2 GB), so the OS, the launcher, and everything else always keep headroom.
 * A heap sized to ~90% of RAM starved the rest of the system and was a direct cause of
 * the "game or launcher crashes a few minutes after launch" reports on lower-end
 * machines.
 */
export function maxAllowedRamMb(totalSystemMb: number): number {
  const safe = Math.min(totalSystemMb - 2048, Math.floor(totalSystemMb * 0.75));
  return Math.max(1024, safe);
}
