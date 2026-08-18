import { create } from "zustand";
import type { CrashInfo, GameOutputPayload } from "@shared/types/ipc";

/**
 * Tracks the real launch lifecycle for every instance: launching (IPC call in flight,
 * or spawned but no "game.started" yet), running (confirmed via the core's process
 * registry), stopped, stopping (kill in flight), crashed (core reported a crash exit),
 * and errored (a launch attempt failed). The renderer never assumes a state on its own —
 * it derives everything from core events (`game.started`/`game.output`/`game.exit`) and
 * periodic reconciliation against `listRunningInstances`.
 */
/** One console line: the game's raw output (with its stream so the console can color
 * stderr/errors) or a launcher-originated message like "Launch failed: …". */
export interface ConsoleLine {
  line: string;
  stream: "stdout" | "stderr";
  /** Epoch ms at capture, so the console can render timestamps and crash diagnosis
   * can look at the tail of the log with real ordering. */
  timestamp: number;
}

interface LaunchState {
  launchingInstanceIds: Set<string>;
  runningInstanceIds: Set<string>;
  stoppingInstanceIds: Set<string>;
  crashedInstanceIds: Set<string>;
  errorInstanceIds: Set<string>;
  errorsByInstance: Record<string, string>;
  crashInfoByInstance: Record<string, CrashInfo>;
  logsByInstance: Record<string, ConsoleLine[]>;
  markLaunching: (instanceId: string, launching: boolean) => void;
  markRunning: (instanceId: string, running: boolean) => void;
  markStopping: (instanceId: string, stopping: boolean) => void;
  markCrashed: (instanceId: string, info: CrashInfo) => void;
  clearCrashed: (instanceId: string) => void;
  markError: (instanceId: string, message: string) => void;
  clearError: (instanceId: string) => void;
  /** Resets every lifecycle flag for an instance (used after a retry or delete). */
  clearLaunchState: (instanceId: string) => void;
  appendLog: (payload: GameOutputPayload) => void;
  /** Appends a coalesced batch of game console lines in ONE state update. The main
   * process delivers game output as batches (see handlers.ts), so a log-flooding game
   * causes one zustand set per flush instead of one per line — without this, a chatty
   * modpack could push thousands of re-renders a second and freeze the renderer. */
  appendLogs: (payloads: GameOutputPayload[]) => void;
  /** Appends a launcher-originated line (e.g. a launch failure) to an instance's
   * console so errors the user must debug always appear there. */
  appendSystemLine: (instanceId: string, line: string) => void;
  clearLog: (instanceId: string) => void;
  /** Kills the Minecraft process for an instance (no-op if nothing is running). */
  kill: (instanceId: string) => Promise<void>;
  /** Reconciles running state against the core's actual process registry. */
  refreshRunning: () => Promise<void>;
}

function toggle(set: Set<string>, value: string, add: boolean): Set<string> {
  const next = new Set(set);
  if (add) {
    next.add(value);
  } else {
    next.delete(value);
  }
  return next;
}

/** Console log cap per instance — the tail is what crash analysis reads, so older
 * lines are trimmed first. */
const MAX_LOG_LINES = 2000;

function appendLogsInternal(
  state: LaunchState,
  payloads: GameOutputPayload[]
): { logsByInstance: LaunchState["logsByInstance"] } {
  const logsByInstance = { ...state.logsByInstance };
  for (const payload of payloads) {
    const existing = logsByInstance[payload.instanceId] ?? [];
    const kept = existing.length >= MAX_LOG_LINES ? existing.slice(-(MAX_LOG_LINES - 1)) : existing;
    logsByInstance[payload.instanceId] = [
      ...kept,
      { line: payload.line, stream: payload.stream, timestamp: Date.now() },
    ];
  }
  return { logsByInstance };
}

export const useLaunchStore = create<LaunchState>((set) => ({
  launchingInstanceIds: new Set(),
  runningInstanceIds: new Set(),
  stoppingInstanceIds: new Set(),
  crashedInstanceIds: new Set(),
  errorInstanceIds: new Set(),
  errorsByInstance: {},
  crashInfoByInstance: {},
  logsByInstance: {},
  markLaunching: (instanceId, launching) =>
    set((state) => ({ launchingInstanceIds: toggle(state.launchingInstanceIds, instanceId, launching) })),
  markRunning: (instanceId, running) =>
    set((state) => ({
      runningInstanceIds: toggle(state.runningInstanceIds, instanceId, running),
      // Any game event (started/output/exit) means the launching phase is over.
      launchingInstanceIds: toggle(state.launchingInstanceIds, instanceId, false),
      // The process ended (or is gone) — clear any stale stop-in-flight flag.
      stoppingInstanceIds: toggle(state.stoppingInstanceIds, instanceId, false),
    })),
  markStopping: (instanceId, stopping) =>
    set((state) => ({ stoppingInstanceIds: toggle(state.stoppingInstanceIds, instanceId, stopping) })),
  markCrashed: (instanceId, info) =>
    set((state) => ({
      crashedInstanceIds: toggle(state.crashedInstanceIds, instanceId, true),
      errorInstanceIds: toggle(state.errorInstanceIds, instanceId, false),
      crashInfoByInstance: { ...state.crashInfoByInstance, [instanceId]: info },
    })),
  clearCrashed: (instanceId) =>
    set((state) => {
      const crashInfoByInstance = { ...state.crashInfoByInstance };
      delete crashInfoByInstance[instanceId];
      return {
        crashedInstanceIds: toggle(state.crashedInstanceIds, instanceId, false),
        crashInfoByInstance,
      };
    }),
  markError: (instanceId, message) =>
    set((state) => ({
      errorInstanceIds: toggle(state.errorInstanceIds, instanceId, true),
      errorsByInstance: { ...state.errorsByInstance, [instanceId]: message },
    })),
  clearError: (instanceId) =>
    set((state) => {
      const errorsByInstance = { ...state.errorsByInstance };
      delete errorsByInstance[instanceId];
      return {
        errorInstanceIds: toggle(state.errorInstanceIds, instanceId, false),
        errorsByInstance,
      };
    }),
  clearLaunchState: (instanceId) =>
    set((state) => {
      const logsByInstance = { ...state.logsByInstance };
      const crashInfoByInstance = { ...state.crashInfoByInstance };
      const errorsByInstance = { ...state.errorsByInstance };
      delete logsByInstance[instanceId];
      delete crashInfoByInstance[instanceId];
      delete errorsByInstance[instanceId];
      return {
        launchingInstanceIds: toggle(state.launchingInstanceIds, instanceId, false),
        runningInstanceIds: toggle(state.runningInstanceIds, instanceId, false),
        stoppingInstanceIds: toggle(state.stoppingInstanceIds, instanceId, false),
        crashedInstanceIds: toggle(state.crashedInstanceIds, instanceId, false),
        errorInstanceIds: toggle(state.errorInstanceIds, instanceId, false),
        logsByInstance,
        crashInfoByInstance,
        errorsByInstance,
      };
    }),
  appendLog: (payload) => set((state) => appendLogsInternal(state, [payload])),
  appendLogs: (payloads) => set((state) => appendLogsInternal(state, payloads)),
  appendSystemLine: (instanceId, line) =>
    set((state) => {
      const existing = state.logsByInstance[instanceId] ?? [];
      const trimmed = existing.length > 2000 ? existing.slice(-2000) : existing;
      return {
        logsByInstance: {
          ...state.logsByInstance,
          [instanceId]: [...trimmed, { line, stream: "stderr", timestamp: Date.now() }],
        },
      };
    }),
  clearLog: (instanceId) =>
    set((state) => ({ logsByInstance: { ...state.logsByInstance, [instanceId]: [] } })),
  kill: async (instanceId) => {
    markStoppingInFlight(instanceId);
    try {
      await window.noxara.killInstance(instanceId);
    } finally {
      // game.exit clears the flag authoritatively; clear it here too so a missing
      // event (kill of an already-dead process) never leaves the UI stuck on STOPPING.
      useLaunchStore.getState().markStopping(instanceId, false);
    }
    // The core kills the process and emits game.exit, which clears the running flag.
    // Optimistically clear BOTH running and launching now so the button flips back
    // instantly while the kill lands; game.exit reconciles the authoritative state.
    set((state) => ({
      runningInstanceIds: toggle(state.runningInstanceIds, instanceId, false),
      launchingInstanceIds: toggle(state.launchingInstanceIds, instanceId, false),
    }));
  },
  refreshRunning: async () => {
    try {
      const running = await window.noxara.listRunningInstances();
      const runningSet = new Set(running);
      set((state) => {
        const nextRunning = new Set(state.runningInstanceIds);
        for (const id of nextRunning) {
          if (!runningSet.has(id)) nextRunning.delete(id);
        }
        for (const id of runningSet) nextRunning.add(id);
        // Anything the core reports as running is definitely not still "launching".
        const launchingInstanceIds = new Set(state.launchingInstanceIds);
        for (const id of runningSet) launchingInstanceIds.delete(id);
        return { runningInstanceIds: nextRunning, launchingInstanceIds };
      });
    } catch {
      // Polling is best-effort; events are the source of truth. Ignore transient failures.
    }
  },
}));

/** Sets the stop-in-flight flag outside zustand's set() so `kill` can await the IPC
 * while still flipping the flag synchronously at the start. */
function markStoppingInFlight(instanceId: string): void {
  useLaunchStore.setState((state) => ({
    stoppingInstanceIds: toggle(state.stoppingInstanceIds, instanceId, true),
  }));
}

/** Shared launch helper used by every page that offers a Play button. Marks the
 * instance as launching for the whole IPC round-trip (which can take a while during
 * first-time file downloads); a later game.started/game.exit event settles the state.
 *
 * Guards against double-launching: an instance that's already launching or already
 * running is left alone rather than spawning a second JVM. */
export async function launchInstance(id: string, extraGameArgs?: string[]): Promise<void> {
  const { markLaunching, markRunning, launchingInstanceIds, runningInstanceIds, appendSystemLine } =
    useLaunchStore.getState();
  if (launchingInstanceIds.has(id) || runningInstanceIds.has(id)) {
    const alreadyRunning = new Error("This instance is already running.");
    appendSystemLine(id, `[launcher] ${alreadyRunning.message}`);
    throw alreadyRunning;
  }
  // A fresh launch retires any previous crash/error diagnosis for this instance.
  useLaunchStore.getState().clearCrashed(id);
  useLaunchStore.getState().clearError(id);
  markLaunching(id, true);
  try {
    await window.noxara.launchInstance(id, extraGameArgs);
    // Don't clear launching here: the game is about to start and we want the button to
    // keep showing an in-progress state until game.started/game.exit arrives. If the
    // process dies instantly, game.exit clears it. If no event ever arrives (extremely
    // unlikely), refreshRunning() clears stale launching state on its next poll.
  } catch (e) {
    markLaunching(id, false);
    markRunning(id, false);
    const message = e instanceof Error ? e.message : "Failed to launch";
    // Surface the failure in the instance's console so it's visible right where the
    // user would look for the error, not just as a toast.
    appendSystemLine(id, `[launcher] Launch failed: ${message}`);
    useLaunchStore.getState().markError(id, message);
    throw e;
  }
}
