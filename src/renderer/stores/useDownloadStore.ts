import { create } from "zustand";
import type {
  ContentDownloadCompletePayload,
  ContentDownloadProgressPayload,
  DownloadCompletePayload,
  DownloadProgressPayload,
  ModDownloadCompletePayload,
  ModDownloadProgressPayload,
  ForgeInstallProgressPayload,
} from "@shared/types/ipc";

/**
 * Unified download registry. Tracks every real download the launcher runs:
 *   * mod / content downloads (single files, keyed by name via Modrinth)
 *   * batch downloads (the core's `downloads.batch` for client jars, libraries,
 *     assets and loader installers — keyed by taskId with per-file + overall progress)
 *   * Forge/NeoForge installer runs (stage + message)
 *
 * Speed / ETA are derived from the byte deltas between progress events (kept in a
 * module-level estimator so they survive React re-renders). Batch updates are
 * throttled: the Rust core can emit a progress event per network chunk, and we only
 * write to the store when something visually meaningful changed.
 */
export type DownloadCategory = "mod" | "resourcepack" | "shader" | "modpack";

export interface DownloadEntry {
  taskId: string;
  /** What kind of work this download represents. */
  kind: "mod" | "content" | "batch";
  name: string;
  instanceId?: string;
  category?: DownloadCategory | null;
  bytesDownloaded: number;
  totalBytes: number;
  /** Batch-only: which file is currently transferring. */
  fileIndex?: number;
  fileCount?: number;
  startedAt: number;
  updatedAt: number;
  bytesPerSec?: number;
  etaSeconds?: number;
  status: "downloading" | "completed" | "failed";
  error?: string;
}

export interface ForgeInstallEntry {
  taskId: string;
  stage: string;
  message: string;
  status: "installing" | "complete";
}

interface DownloadState {
  downloads: DownloadEntry[];
  forgeInstalls: ForgeInstallEntry[];
  onProgress: (p: ModDownloadProgressPayload | ContentDownloadProgressPayload) => void;
  onComplete: (p: ModDownloadCompletePayload | ContentDownloadCompletePayload) => void;
  onBatchProgress: (p: DownloadProgressPayload) => void;
  onBatchComplete: (p: DownloadCompletePayload) => void;
  onForgeProgress: (p: ForgeInstallProgressPayload) => void;
  clearCompleted: () => void;
}

/** Per-taskId estimator of transfer rate, held outside zustand so it isn't reset by
 * re-renders and can smooth the byte-delta between throttle gaps. */
const speedEstimator = new Map<string, { lastBytes: number; lastTime: number; bytesPerSec: number }>();

function estimateSpeed(taskId: string, bytesDownloaded: number): number {
  const now = Date.now();
  const prev = speedEstimator.get(taskId);
  if (!prev) {
    speedEstimator.set(taskId, { lastBytes: bytesDownloaded, lastTime: now, bytesPerSec: 0 });
    return 0;
  }
  const dt = now - prev.lastTime;
  let bps = prev.bytesPerSec;
  if (dt > 150) {
    const instant = ((bytesDownloaded - prev.lastBytes) / dt) * 1000;
    if (instant >= 0) bps = bps === 0 ? instant : bps * 0.6 + instant * 0.4;
  }
  speedEstimator.set(taskId, { lastBytes: bytesDownloaded, lastTime: now, bytesPerSec: bps });
  return Math.round(bps);
}

/** Merges the fields every progress event (batch, mod, content) has in common. */
function baseEntry(taskId: string, name: string, bytesDownloaded: number, totalBytes: number): DownloadEntry {
  const existing = speedEstimator.get(taskId);
  const startedAt = existing?.lastTime ?? Date.now();
  const bytesPerSec = estimateSpeed(taskId, bytesDownloaded);
  const remaining = Math.max(0, totalBytes - bytesDownloaded);
  const etaSeconds = bytesPerSec > 0 ? Math.ceil(remaining / bytesPerSec) : undefined;
  return {
    taskId,
    kind: "batch",
    name,
    bytesDownloaded,
    totalBytes,
    startedAt,
    updatedAt: Date.now(),
    bytesPerSec,
    etaSeconds,
    status: "downloading",
  };
}

function isModPayload(p: ModDownloadProgressPayload | ContentDownloadProgressPayload): p is ModDownloadProgressPayload {
  return "modName" in p;
}

/**
 * Only push a state write when something meaningful changed. The Rust core emits a
 * batch progress event per downloaded chunk — writing to zustand (and re-rendering
 * every subscribed component) on each one would be wasteful.
 */
function batchChangeIsWorthRendering(prev: DownloadEntry | undefined, next: DownloadEntry): boolean {
  if (!prev) return true;
  if (prev.fileIndex !== next.fileIndex) return true;
  if (prev.status !== next.status) return true;
  if (next.totalBytes > 0 && prev.totalBytes > 0) {
    // Render when the overall percent ticked up by at least 1%.
    if (Math.floor((next.bytesDownloaded / next.totalBytes) * 100) !== Math.floor((prev.bytesDownloaded / prev.totalBytes) * 100)) {
      return true;
    }
  }
  // Render at most ~3x per second even if <1% changed (slow progress on big files).
  return next.updatedAt - prev.updatedAt >= 350;
}

export const useDownloadStore = create<DownloadState>((set) => ({
  downloads: [],
  forgeInstalls: [],

  onProgress: (p) =>
    set((state) => {
      const bytesDownloaded = p.bytesDownloaded;
      const totalBytes = p.totalBytes;
      const entry = baseEntry(p.taskId, isModPayload(p) ? p.modName : p.name, bytesDownloaded, totalBytes);
      if (isModPayload(p)) {
        entry.kind = "mod";
        entry.category = "mod";
        entry.instanceId = p.instanceId;
      } else {
        entry.kind = "content";
        entry.category = p.category;
        entry.instanceId = p.instanceId;
      }
      const idx = state.downloads.findIndex((d) => d.taskId === p.taskId);
      if (idx === -1) return { downloads: [entry, ...state.downloads] };
      const next = [...state.downloads];
      const merged = { ...next[idx], ...entry };
      if (next[idx].kind === "batch" && !batchChangeIsWorthRendering(next[idx], merged)) return {};
      next[idx] = merged;
      return { downloads: next };
    }),

  onComplete: (p) =>
    set((state) => {
      const done = { status: p.success ? ("completed" as const) : ("failed" as const), error: p.error };
      return {
        downloads: state.downloads.map((d) => (d.taskId === p.taskId ? { ...d, ...done } : d)),
      };
    }),

  onBatchProgress: (p) =>
    set((state) => {
      const entry = baseEntry(p.taskId, p.label, p.bytesDownloaded, p.totalBytes);
      entry.kind = "batch";
      entry.fileIndex = p.fileIndex;
      entry.fileCount = p.fileCount;
      const idx = state.downloads.findIndex((d) => d.taskId === p.taskId);
      if (idx === -1) return { downloads: [entry, ...state.downloads] };
      const next = [...state.downloads];
      const merged = { ...next[idx], ...entry };
      if (!batchChangeIsWorthRendering(next[idx], merged)) return {};
      next[idx] = merged;
      return { downloads: next };
    }),

  onBatchComplete: (p) =>
    set((state) => ({
      downloads: state.downloads.map((d) =>
        d.taskId === p.taskId
          ? p.failed.length > 0
            ? {
                ...d,
                status: "failed",
                error: `${p.failed.length} file(s) failed: ${p.failed.slice(0, 3).join(", ")}${p.failed.length > 3 ? "…" : ""}`,
              }
            : { ...d, status: "completed", bytesDownloaded: d.totalBytes }
          : d
      ),
    })),

  onForgeProgress: (p) =>
    set((state) => {
      const idx = state.forgeInstalls.findIndex((f) => f.taskId === p.taskId);
      const entry: ForgeInstallEntry = {
        taskId: p.taskId,
        stage: p.stage,
        message: p.message,
        status: p.stage === "complete" ? "complete" : "installing",
      };
      if (idx === -1) return { forgeInstalls: [entry, ...state.forgeInstalls] };
      const next = [...state.forgeInstalls];
      next[idx] = entry;
      return { forgeInstalls: next };
    }),

  clearCompleted: () =>
    set((state) => ({
      downloads: state.downloads.filter((d) => d.status === "downloading"),
      forgeInstalls: state.forgeInstalls.filter((f) => f.status === "installing"),
    })),
}));

/** Convenience: the active (still downloading) entries, most recent first. */
export function selectActiveDownloads(downloads: DownloadEntry[]): DownloadEntry[] {
  return downloads.filter((d) => d.status === "downloading");
}

/** Convenience: finished/failed entries, most recent first. */
export function selectFinishedDownloads(downloads: DownloadEntry[]): DownloadEntry[] {
  return downloads.filter((d) => d.status !== "downloading");
}

export function formatBytes(n: number): string {
  if (n <= 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatSpeed(bytesPerSec: number | undefined): string {
  if (!bytesPerSec || bytesPerSec <= 0) return "";
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(seconds: number | undefined): string {
  if (seconds === undefined || !isFinite(seconds) || seconds <= 0) return "";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}