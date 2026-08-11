import { create } from "zustand";
import type { ModDownloadCompletePayload, ModDownloadProgressPayload } from "@shared/types/ipc";

export interface ModDownloadEntry {
  taskId: string;
  modName: string;
  instanceId: string;
  bytesDownloaded: number;
  totalBytes: number;
  status: "downloading" | "completed" | "failed";
  error?: string;
}

interface DownloadState {
  downloads: ModDownloadEntry[];
  onProgress: (p: ModDownloadProgressPayload) => void;
  onComplete: (p: ModDownloadCompletePayload) => void;
  clearCompleted: () => void;
}

export const useDownloadStore = create<DownloadState>((set) => ({
  downloads: [],
  onProgress: (p) =>
    set((state) => {
      const idx = state.downloads.findIndex((d) => d.taskId === p.taskId);
      const entry: ModDownloadEntry = {
        taskId: p.taskId,
        modName: p.modName,
        instanceId: p.instanceId,
        bytesDownloaded: p.bytesDownloaded,
        totalBytes: p.totalBytes,
        status: "downloading",
      };
      if (idx === -1) return { downloads: [entry, ...state.downloads] };
      const next = [...state.downloads];
      next[idx] = entry;
      return { downloads: next };
    }),
  onComplete: (p) =>
    set((state) => ({
      downloads: state.downloads.map((d) =>
        d.taskId === p.taskId
          ? { ...d, status: p.success ? "completed" : "failed", error: p.error }
          : d
      ),
    })),
  clearCompleted: () =>
    set((state) => ({ downloads: state.downloads.filter((d) => d.status === "downloading") })),
}));
