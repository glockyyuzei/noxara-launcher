/**
 * Global Activity Manager — the single source of truth for every long-running
 * operation in Noxara (downloads, installs, imports/exports, repairs, backups,
 * launches). Services register an activity, then report REAL progress through it;
 * the renderer's global overlay renders these records. Nothing in the UI fabricates
 * progress — every field comes from an actual backend operation.
 *
 * Lifecycle: start -> queued/preparing -> ... -> completed | failed | cancelled.
 * Completed/failed/cancelled records move into a bounded recent-history list so the
 * UI can show "recently finished" without the registry growing forever.
 *
 * This module intentionally imports NO other services (only shared types) to avoid
 * import cycles — the IPC layer (handlers.ts) wires progress sources into it and
 * forwards its events to the renderer.
 */
import { EventEmitter } from "node:events";
import type {
  ActivityListPayload,
  ActivityProgress,
  ActivityRecord,
  ActivityStatus,
  ActivityType,
  ActivityUpdatedPayload,
} from "../../shared/types/ipc";
import {
  cancelDownload,
  hasDownload,
  listDownloadTasks,
  retryDownload,
} from "./download-control";

/** Emits "updated" (payload: ActivityUpdatedPayload) and "removed" (payload: { id }). */
export const activityEvents = new EventEmitter();

export interface ActivityControl {
  /** Called by cancelActivity when the activity is cancellable. */
  cancel?: () => Promise<void>;
  /** Called by retryActivity when the activity is retryable. */
  retry?: () => Promise<void>;
}

interface InternalActivity extends ActivityRecord {
  control?: ActivityControl;
}

const ACTIVE_CAP = 40;
const RECENT_CAP = 25;

/** Statuses that end an activity's lifecycle. Once an activity is in one of these,
 * it must never regress back to an active state — the UI derives live state from the
 * registry and a resurrected "downloading"/"launching" record would leave an instance
 * stuck looking busy after it actually finished (e.g. a stale progressActivity firing
 * after succeedActivity for the same activity id). Only startActivity() may reset a
 * terminal record, and only deliberately (a retry). */
const TERMINAL_STATUSES = new Set<ActivityStatus>(["completed", "failed", "cancelled"]);

const registry = new Map<string, InternalActivity>();
const activeIds: string[] = [];
const recentIds: string[] = [];

function emitUpdated(activity: ActivityRecord, terminal: boolean): void {
  activityEvents.emit("updated", { activity, terminal } satisfies ActivityUpdatedPayload);
}

function snapshot(activity: InternalActivity): ActivityRecord {
  const { control: _control, ...record } = activity;
  return record;
}

function prune(): void {
  while (activeIds.length > ACTIVE_CAP) {
    const id = activeIds.shift();
    if (!id) break;
    registry.delete(id);
    activityEvents.emit("removed", { id });
  }
  while (recentIds.length > RECENT_CAP) {
    const id = recentIds.shift();
    if (!id) break;
    registry.delete(id);
    activityEvents.emit("removed", { id });
  }
}

/**
 * Registers a new activity. Returns an updater closure for ergonomic service use.
 * The returned object lets callers chain updates without touching the map directly.
 */
export function startActivity(
  id: string,
  init: {
    type: ActivityType;
    title: string;
    description?: string;
    instanceId?: string;
    status?: ActivityStatus;
    control?: ActivityControl;
  }
): { update: (patch: Partial<ActivityRecord>) => void; get: () => ActivityRecord | undefined } {
  const now = Date.now();
  const activity: InternalActivity = {
    id,
    type: init.type,
    status: init.status ?? "queued",
    title: init.title,
    description: init.description,
    instanceId: init.instanceId,
    progress: {},
    cancellable: false,
    retryable: false,
    createdAt: now,
    updatedAt: now,
    control: init.control,
  };

  const existing = registry.get(id);
  if (existing) {
    // Re-registering the same id (e.g. a retry) resets it to active.
    const wasActive = activeIds.includes(id);
    const patch = {
      ...activity,
      status: activity.status,
      error: undefined,
      createdAt: now,
      updatedAt: now,
    };
    registry.set(id, patch);
    if (wasActive) {
      emitUpdated(snapshot(patch), false);
      return { update: updater(id), get: () => snapshot(patch) };
    }
  }

  registry.set(id, activity);
  activeIds.push(id);
  emitUpdated(snapshot(activity), false);
  prune();
  return { update: updater(id), get: () => snapshot(activity) };
}

function updater(id: string) {
  return (patch: Partial<ActivityRecord>) => updateActivity(id, patch);
}

/** Merges a partial update into an existing activity (no-op if it doesn't exist).
 * Terminal activities are immutable here: a completed/failed/cancelled record must
 * not be nudged back to life by a straggler progress event or status transition. */
export function updateActivity(id: string, patch: Partial<ActivityRecord>): void {
  const activity = registry.get(id);
  if (!activity) return;
  if (TERMINAL_STATUSES.has(activity.status)) return;
  Object.assign(activity, patch, { updatedAt: Date.now() });
  emitUpdated(snapshot(activity), false);
}

/** Merges numeric progress + an optional status into an activity. Like updateActivity,
 * it refuses to touch a terminal record so a late progress event can never resurrect
 * a finished activity (the root cause of instances showing "Launching" after close). */
export function progressActivity(
  id: string,
  progress: ActivityProgress,
  status?: ActivityStatus,
  patch?: Partial<ActivityRecord>
): void {
  const activity = registry.get(id);
  if (!activity) return;
  if (TERMINAL_STATUSES.has(activity.status)) return;
  const merged = {
    ...activity.progress,
    ...progress,
    currentBytes: progress.currentBytes ?? activity.progress.currentBytes,
    totalBytes: progress.totalBytes ?? activity.progress.totalBytes,
    progress: progress.progress ?? activity.progress.progress,
  };
  Object.assign(activity, { ...patch, progress: merged }, { updatedAt: Date.now() });
  if (status) activity.status = status;
  emitUpdated(snapshot(activity), false);
}

/** Marks an activity successfully finished and moves it into recent history. */
export function succeedActivity(id: string, patch?: Partial<ActivityRecord>): void {
  finishActivity(id, "completed", patch);
}

/** Marks an activity failed and moves it into recent history. */
export function failActivity(id: string, error: string, patch?: Partial<ActivityRecord>): void {
  finishActivity(id, "failed", { ...patch, error });
}

/** Marks an activity cancelled and moves it into recent history. */
export function cancelActivity(id: string): void {
  const activity = registry.get(id);
  if (!activity) return;
  if (hasDownload(id)) {
    cancelDownload(id).catch(() => undefined);
  } else {
    activity.control?.cancel?.().catch(() => undefined);
  }
  finishActivity(id, "cancelled");
}

function finishActivity(id: string, status: "completed" | "failed" | "cancelled", patch?: Partial<ActivityRecord>): void {
  const activity = registry.get(id);
  if (!activity) return;
  Object.assign(activity, patch ?? {}, { status }, { updatedAt: Date.now() });
  // Move from active to recent (once — guard against double terminal transitions).
  if (activeIds.includes(id)) {
    activeIds.splice(activeIds.indexOf(id), 1);
    recentIds.push(id);
    prune();
    emitUpdated(snapshot(activity), true);
  } else {
    emitUpdated(snapshot(activity), false);
  }
}

/** Retries a failed activity: delegates to download-control when the operation is a
 * single-file download, otherwise to the activity's own control hook. */
export async function retryActivity(id: string): Promise<void> {
  if (hasDownload(id)) {
    await retryDownload(id);
    const activity = registry.get(id);
    if (activity) {
      // The retried op re-runs under the same id and flips back to active.
      const recentIdx = recentIds.indexOf(id);
      if (recentIdx !== -1) recentIds.splice(recentIdx, 1);
      if (!activeIds.includes(id)) activeIds.push(id);
      activity.status = "queued";
      activity.error = undefined;
      activity.createdAt = Date.now();
      emitUpdated(snapshot(activity), false);
    }
    return;
  }
  const activity = registry.get(id);
  if (!activity) throw new Error("This operation can't be retried (it may no longer exist).");
  if (!activity.retryable || !activity.control?.retry) {
    throw new Error("This operation can't be retried from here. Restart the action from its page.");
  }
  await activity.control.retry();
}

/** Reconciles cancellable/retryable flags with download-control's task registry, so
 * single-file mod/content downloads expose Cancel/Retry while batch operations don't. */
export function syncDownloadControls(tasks: Array<{ taskId: string }>): void {
  const taskIds = new Set(tasks.map((t) => t.taskId));
  for (const id of registry.keys()) {
    const activity = registry.get(id);
    if (!activity) continue;
    if (taskIds.has(id)) {
      if (!activity.cancellable || !activity.retryable) {
        activity.cancellable = true;
        activity.retryable = true;
        emitUpdated(snapshot(activity), false);
      }
    } else if (
      (activity.cancellable || activity.retryable) &&
      // Activities with a control.cancel (batch downloads, launches, repairs) keep
      // their Cancel affordance — only plain read-only activities lose the flags.
      !activity.control?.cancel
    ) {
      activity.cancellable = false;
      activity.retryable = false;
      emitUpdated(snapshot(activity), false);
    }
  }
}

export function syncControlsNow(): void {
  syncDownloadControls(listDownloadTasks());
}

/** Active (in-progress) activities, newest first, then recent history. */
export function listActivities(): ActivityListPayload {
  const active = [...activeIds]
    .reverse()
    .map((id) => registry.get(id))
    .filter((a): a is InternalActivity => Boolean(a))
    .map(snapshot);
  const recent = [...recentIds]
    .reverse()
    .map((id) => registry.get(id))
    .filter((a): a is InternalActivity => Boolean(a))
    .map(snapshot);
  return { activities: [...active, ...recent] };
}

/** Removes every finished/failed/cancelled activity from the registry. */
export function clearCompletedActivities(): void {
  const removed: string[] = [];
  for (let i = recentIds.length - 1; i >= 0; i--) {
    const id = recentIds[i];
    registry.delete(id);
    recentIds.splice(i, 1);
    removed.push(id);
  }
  for (const id of removed) {
    activityEvents.emit("removed", { id });
  }
}

/** True while an activity id is still active (used by services for id reuse). */
export function isActivityActive(id: string): boolean {
  return activeIds.includes(id);
}