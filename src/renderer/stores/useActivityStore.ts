import { create } from "zustand";
import type {
  ActivityRecord,
  ActivityRemovedPayload,
  ActivityUpdatedPayload,
} from "@shared/types/ipc";

/**
 * Global activity registry mirror of the main-process ActivityManager. Every
 * long-running operation (downloads, installs, imports/exports, repairs, launches)
 * reports through it; the bottom-right ActivityOverlay renders these records.
 * The renderer never fabricates progress — each field comes from a real backend event.
 */
interface ActivityState {
  /** Active + recent records (active first, then recent history). */
  activities: ActivityRecord[];
  /** Ids that have entered a finished state (completed/failed/cancelled). */
  recentIds: Set<string>;
  hydrate: () => Promise<void>;
  applyUpdate: (p: ActivityUpdatedPayload) => void;
  applyRemoved: (p: ActivityRemovedPayload) => void;
  cancel: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  clearCompleted: () => Promise<void>;
}

const ACTIVE_MAX = 40;
const RECENT_MAX = 25;

/** Per-activity-id estimator of transfer rate, held outside zustand so it survives
 * React re-renders and can smooth byte deltas between throttled backend events. */
const speedEstimator = new Map<string, { lastBytes: number; lastTime: number; bytesPerSec: number }>();

function estimateSpeed(id: string, currentBytes: number | undefined, totalBytes: number | undefined): {
  speedBytesPerSec?: number;
  etaSeconds?: number;
} {
  if (currentBytes === undefined) return {};
  const now = Date.now();
  const prev = speedEstimator.get(id);
  if (!prev) {
    speedEstimator.set(id, { lastBytes: currentBytes, lastTime: now, bytesPerSec: 0 });
    return {};
  }
  const dt = now - prev.lastTime;
  let bps = prev.bytesPerSec;
  if (dt > 150) {
    const instant = ((currentBytes - prev.lastBytes) / dt) * 1000;
    if (instant >= 0) bps = bps === 0 ? instant : bps * 0.6 + instant * 0.4;
  }
  speedEstimator.set(id, { lastBytes: currentBytes, lastTime: now, bytesPerSec: bps });
  const speedBytesPerSec = Math.round(bps);
  const etaSeconds =
    speedBytesPerSec > 0 && totalBytes !== undefined
      ? Math.ceil(Math.max(0, totalBytes - currentBytes) / speedBytesPerSec)
      : undefined;
  return { speedBytesPerSec, etaSeconds };
}

export const useActivityStore = create<ActivityState>((set) => ({
  activities: [],
  recentIds: new Set(),

  hydrate: async () => {
    try {
      const { activities } = await window.noxara.listActivities();
      // Fresh registry (in-memory) means everything present at startup is in-flight.
      set({ activities, recentIds: new Set() });
    } catch {
      // Preload/IPC unavailable (e.g. dev renderer) — leave the registry empty.
    }
  },

  applyUpdate: (p) =>
    set((state) => {
      const { activity, terminal } = p;
      const recentIds = new Set(state.recentIds);
      if (terminal) recentIds.add(activity.id);

      const idx = state.activities.findIndex((a) => a.id === activity.id);
      const enriched = enrichSpeed(activity);

      let activities: ActivityRecord[];
      if (idx === -1) {
        // New record: active ones bubble to the front, finished ones go to the back.
        const isRecent = recentIds.has(activity.id);
        activities = isRecent
          ? [...state.activities, enriched]
          : [enriched, ...state.activities];
      } else {
        activities = [...state.activities];
        activities[idx] = enriched;
      }

      // Bounded registry, mirroring the backend caps.
      activities = activities.slice(0, ACTIVE_MAX + RECENT_MAX);
      return { activities, recentIds };
    }),

  applyRemoved: (p) =>
    set((state) => {
      const recentIds = new Set(state.recentIds);
      recentIds.delete(p.id);
      speedEstimator.delete(p.id);
      return {
        activities: state.activities.filter((a) => a.id !== p.id),
        recentIds,
      };
    }),

  cancel: async (id) => {
    await window.noxara.cancelActivity(id);
  },

  retry: async (id) => {
    await window.noxara.retryActivity(id);
  },

  clearCompleted: async () => {
    await window.noxara.clearCompletedActivities();
    set({ recentIds: new Set() });
  },
}));

function enrichSpeed(activity: ActivityRecord): ActivityRecord {
  const isActive = activity.status !== "completed" && activity.status !== "failed" && activity.status !== "cancelled";
  if (!isActive || activity.progress.currentBytes === undefined) return activity;
  const { speedBytesPerSec, etaSeconds } = estimateSpeed(activity.id, activity.progress.currentBytes, activity.progress.totalBytes);
  return {
    ...activity,
    progress: { ...activity.progress, speedBytesPerSec, etaSeconds },
  };
}

export function selectActive(activities: ActivityRecord[]): ActivityRecord[] {
  return activities.filter((a) => a.status !== "completed" && a.status !== "failed" && a.status !== "cancelled");
}

export function selectRecent(activities: ActivityRecord[]): ActivityRecord[] {
  return activities.filter((a) => a.status === "completed" || a.status === "failed" || a.status === "cancelled");
}