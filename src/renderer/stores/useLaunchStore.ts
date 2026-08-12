import { create } from "zustand";
import type { GameOutputPayload } from "@shared/types/ipc";

/**
 * Tracks the real launch lifecycle for every instance: launching (IPC call in flight,
 * or spawned but no "game.started" yet), running (confirmed via the core's process
 * registry), and stopped. The renderer never assumes a state on its own — it derives
 * everything from core events (`game.started`/`game.output`/`game.exit`) and periodic
 * reconciliation against `listRunningInstances`, so a process killed manually or a
 * crash is reflected correctly even if an event was missed.
 */
interface LaunchState {
  launchingInstanceIds: Set<string>;
  runningInstanceIds: Set<string>;
  logsByInstance: Record<string, string[]>;
  markLaunching: (instanceId: string, launching: boolean) => void;
  markRunning: (instanceId: string, running: boolean) => void;
  appendLog: (payload: GameOutputPayload) => void;
  clearLog: (instanceId: string) => void;
  /** Kills the Minecraft process for an instance (no-op if nothing is running). */
  kill: (instanceId: string) => Promise<void>;
  /** Reconciles running state against the core's actual process registry. */
  refreshRunning: () => Promise<void>;
}

function toggle(set: Set<string>, value: string, add: boolean): Set<string> {
  const next = new Set(set);
  add ? next.add(value) : next.delete(value);
  return next;
}

export const useLaunchStore = create<LaunchState>((set) => ({
  launchingInstanceIds: new Set(),
  runningInstanceIds: new Set(),
  logsByInstance: {},
  markLaunching: (instanceId, launching) =>
    set((state) => ({ launchingInstanceIds: toggle(state.launchingInstanceIds, instanceId, launching) })),
  markRunning: (instanceId, running) =>
    set((state) => ({
      runningInstanceIds: toggle(state.runningInstanceIds, instanceId, running),
      // Any game event (started/output/exit) means the launching phase is over.
      launchingInstanceIds: toggle(state.launchingInstanceIds, instanceId, false),
    })),
  appendLog: (payload) =>
    set((state) => {
      const existing = state.logsByInstance[payload.instanceId] ?? [];
      const trimmed = existing.length > 2000 ? existing.slice(-2000) : existing;
      return {
        logsByInstance: {
          ...state.logsByInstance,
          [payload.instanceId]: [...trimmed, payload.line],
        },
      };
    }),
  clearLog: (instanceId) =>
    set((state) => ({ logsByInstance: { ...state.logsByInstance, [instanceId]: [] } })),
  kill: async (instanceId) => {
    await window.noxara.killInstance(instanceId);
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

/** Shared launch helper used by every page that offers a Play button. Marks the
 * instance as launching for the whole IPC round-trip (which can take a while during
 * first-time file downloads); a later game.started/game.exit event settles the state.
 *
 * Guards against double-launching: an instance that's already launching or already
 * running is left alone rather than spawning a second JVM. */
export async function launchInstance(id: string, extraGameArgs?: string[]): Promise<void> {
  const { markLaunching, markRunning, launchingInstanceIds, runningInstanceIds } = useLaunchStore.getState();
  if (launchingInstanceIds.has(id) || runningInstanceIds.has(id)) {
    throw new Error("This instance is already running.");
  }
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
    throw e;
  }
}
