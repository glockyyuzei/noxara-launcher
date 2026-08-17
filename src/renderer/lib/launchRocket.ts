/**
 * Pure phase machine for the Minecraft launch rocket overlay.
 *
 * The overlay is driven EXCLUSIVELY by the real instance lifecycle held in
 * useLaunchStore (which itself derives from core events: game.started / game.output /
 * game.exit, reconciled against the core's process registry). There is no fake timer
 * deciding when Minecraft is "running":
 *
 *   launching instance  ->  ignition -> hold   (rocket burns on the pad)
 *   instance runs       ->  exit               (rocket accelerates off-screen)
 *   crash / error       ->  fade               (overlay disappears, error UI takes over)
 *
 * The only time-based parts are *presentation* durations (how long the ignition plays,
 * how long the exit sweep takes to cross the screen) — never lifecycle decisions.
 */

export type RocketPhase = "ignition" | "hold" | "exit" | "fade" | "idle";

export interface RocketState {
  /** The instance the overlay is currently telling the story for, or null when idle. */
  instanceId: string | null;
  phase: RocketPhase;
}

/** Snapshot of the real launch store the machine reacts to. */
export interface RocketInput {
  launching: ReadonlySet<string>;
  running: ReadonlySet<string>;
  crashed: ReadonlySet<string>;
  errored: ReadonlySet<string>;
}

/** Presentation durations (ms). Not used to decide when Minecraft is running. */
export const ROCKET_IGNITION_MS = 650;
export const ROCKET_EXIT_MS = 1100;
export const ROCKET_FADE_MS = 400;

export function initialRocketState(): RocketState {
  return { instanceId: null, phase: "idle" };
}

/** Pure transition. Returns a new state whenever the lifecycle demands one, and the
 * same object reference when nothing changed (so callers can bail on re-renders). */
export function nextRocketState(prev: RocketState, input: RocketInput): RocketState {
  // Nothing showing: start when a real launch begins.
  if (prev.phase === "idle") {
    const id = pickLaunching(input.launching);
    return id ? { instanceId: id, phase: "ignition" } : prev;
  }

  const id = prev.instanceId;
  if (id === null) return { instanceId: null, phase: "idle" };

  // The game reached running: accelerate the rocket off-screen.
  if (input.running.has(id)) return { instanceId: id, phase: "exit" };
  // A crash or a failed launch: fade the overlay away so the error UI can take over.
  if (input.crashed.has(id) || input.errored.has(id)) return { instanceId: id, phase: "fade" };
  // The instance fell out of the launch store without running (state cleared) — bail.
  if (!input.launching.has(id)) return { instanceId: id, phase: "fade" };

  // Still launching — keep burning on the pad.
  return prev;
}

/** The "most relevant" launching instance: the one most recently started (insertion
 * order), matching how the presence controller picks the freshest session. */
export function pickLaunching(launching: ReadonlySet<string>): string | null {
  let last: string | null = null;
  for (const id of launching) last = id;
  return last;
}