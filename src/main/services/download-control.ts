/**
 * User-facing download control for the standalone file downloads the Electron main
 * process performs (mods, resource packs, shaders, modpack archives — the single-file
 * `downloadWithProgress` flows in mods.ts / content.ts).
 *
 * Batch downloads ('downloads.batch' launched by the core for client jars / libraries /
 * assets / loader installers) are intentionally NOT cancellable here: they're part of
 * an atomic launch/install operation, and retrying them means re-running the launch
 * that triggered them. This module only manages the single-file flows where Cancel and
 * Retry make sense and are safe to interrupt.
 *
 * Every task keeps an AbortController that `downloadWithProgress` streams against, so
 * Cancel aborts the in-flight fetch immediately. Retry re-runs the same operation under
 * the SAME taskId (so the store's entry flips back to "downloading") with a fresh
 * controller — a cancelled download can be retried, since Cancel only aborts the pipe.
 *
 * Failed tasks stay registered (retryable) until they succeed, are explicitly cleaned
 * up by a re-run, or age past `FAILED_TASK_TTL_MS` — the ops map shouldn't grow
 * unbounded just because a user ignores a row on the Downloads page.
 */
import { EventEmitter } from "node:events";
import type { DownloadTaskInfo } from "../../shared/types/ipc";

export interface DownloadOperation {
  kind: "mod" | "content";
  /** Runs the full operation again using the same taskId (used by Retry). Must not
   * re-register; this module swaps in a fresh abort controller before invoking. */
  run: () => Promise<void>;
}

const ops = new Map<string, DownloadOperation>();
const controllers = new Map<string, AbortController>();
const registeredAt = new Map<string, number>();

/** Failed entries older than this are dropped so the retry registry can't grow forever. */
const FAILED_TASK_TTL_MS = 10 * 60 * 1000;

/** Emits "changed" whenever a task is registered/unregistered (bookkeeping/UI sync). */
export const downloadControlEvents = new EventEmitter();

function emitChanged(): void {
  const now = Date.now();
  for (const [taskId, at] of registeredAt) {
    if (now - at <= FAILED_TASK_TTL_MS) continue;
    ops.delete(taskId);
    controllers.get(taskId)?.abort();
    controllers.delete(taskId);
    registeredAt.delete(taskId);
  }
  downloadControlEvents.emit("changed");
}

/** Registers a task so Cancel/Retry can act on it. Swaps in a fresh controller. */
export function registerDownload(taskId: string, op: DownloadOperation): void {
  ops.set(taskId, op);
  controllers.set(taskId, new AbortController());
  registeredAt.set(taskId, Date.now());
  emitChanged();
}

/** Marks a download done and forgets its cancel/retry handles. If it's still
 * streaming (e.g. the op threw), aborting here stops the pipe as a safety net. */
export function unregisterDownload(taskId: string): void {
  ops.delete(taskId);
  controllers.get(taskId)?.abort();
  controllers.delete(taskId);
  registeredAt.delete(taskId);
  emitChanged();
}

/** The AbortSignal the in-flight download stream should obey, if any. */
export function signalFor(taskId: string): AbortSignal | undefined {
  return controllers.get(taskId)?.signal;
}

/** True while a taskId could still be cancelled and/or retried. */
export function hasDownload(taskId: string): boolean {
  return ops.has(taskId);
}

/** Every currently retryable single-file download, for the renderer's Downloads page. */
export function listDownloadTasks(): DownloadTaskInfo[] {
  return Array.from(ops.entries()).map(([taskId, op]) => ({ taskId, kind: op.kind }));
}

export async function cancelDownload(taskId: string): Promise<void> {
  const controller = controllers.get(taskId);
  if (!controller) throw new Error("This download can't be cancelled (it may have already finished).");
  controller.abort();
}

export async function retryDownload(taskId: string): Promise<void> {
  const op = ops.get(taskId);
  if (!op) {
    throw new Error("This download can't be retried (it may have already finished). Restart the action from its page.");
  }
  // Fresh controller so a previous Cancel doesn't immediately kill the retry.
  controllers.set(taskId, new AbortController());
  try {
    await op.run();
    // The op re-ran the whole install and succeeded, which ends with a complete
    // event; drop the handles so the finished entry is clean.
    ops.delete(taskId);
    controllers.get(taskId)?.abort();
    controllers.delete(taskId);
    registeredAt.delete(taskId);
    emitChanged();
  } catch (err) {
    // Retry failed — keep the handles so the user can try again.
    throw err;
  }
}