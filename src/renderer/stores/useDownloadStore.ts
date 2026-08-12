import { create } from "zustand";
import type {
  ContentDownloadCompletePayload,
  ContentDownloadProgressPayload,
  ModDownloadCompletePayload,
  ModDownloadProgressPayload,
  ForgeInstallProgressPayload,
} from "@shared/types/ipc";

export type DownloadProgressPayload = ModDownloadProgressPayload | ContentDownloadProgressPayload;
export type DownloadCompletePayload = ModDownloadCompletePayload | ContentDownloadCompletePayload;

export interface DownloadEntry {
  taskId: string;
  name: string;
  instanceId: string;
  category: "mod" | "resourcepack" | "shader" | "modpack" | null;
  bytesDownloaded: number;
  totalBytes: number;
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
  onProgress: (p: DownloadProgressPayload) => void;
  onComplete: (p: DownloadCompletePayload) => void;
  onForgeProgress: (p: ForgeInstallProgressPayload) => void;
  clearCompleted: () => void;
}

function normalizeProgress(p: DownloadProgressPayload): DownloadEntry {
  return "modName" in p
    ? {
        taskId: p.taskId,
        name: p.modName,
        instanceId: p.instanceId,
        category: "mod",
        bytesDownloaded: p.bytesDownloaded,
        totalBytes: p.totalBytes,
        status: "downloading",
      }
    : {
        taskId: p.taskId,
        name: p.name,
        instanceId: p.instanceId,
        category: p.category,
        bytesDownloaded: p.bytesDownloaded,
        totalBytes: p.totalBytes,
        status: "downloading",
      };
}

function normalizeComplete(p: DownloadCompletePayload): Pick<DownloadEntry, "status" | "error"> {
  return { status: p.success ? "completed" : "failed", error: p.error };
}

export const useDownloadStore = create<DownloadState>((set) => ({
  downloads: [],
  forgeInstalls: [],
  onProgress: (p) =>
    set((state) => {
      const entry = normalizeProgress(p);
      const idx = state.downloads.findIndex((d) => d.taskId === p.taskId);
      if (idx === -1) return { downloads: [entry, ...state.downloads] };
      const next = [...state.downloads];
      next[idx] = entry;
      return { downloads: next };
    }),
  onComplete: (p) =>
    set((state) => {
      const done = normalizeComplete(p);
      return {
        downloads: state.downloads.map((d) =>
          d.taskId === p.taskId ? { ...d, ...done } : d
        ),
      };
    }),
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
