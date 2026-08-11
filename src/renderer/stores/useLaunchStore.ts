import { create } from "zustand";
import type { DownloadProgressPayload, GameOutputPayload } from "@shared/types/ipc";

interface LaunchState {
  activeDownload: DownloadProgressPayload | null;
  runningInstanceIds: Set<string>;
  logsByInstance: Record<string, string[]>;
  setActiveDownload: (p: DownloadProgressPayload | null) => void;
  markRunning: (instanceId: string, running: boolean) => void;
  appendLog: (payload: GameOutputPayload) => void;
  clearLog: (instanceId: string) => void;
}

export const useLaunchStore = create<LaunchState>((set) => ({
  activeDownload: null,
  runningInstanceIds: new Set(),
  logsByInstance: {},
  setActiveDownload: (p) => set({ activeDownload: p }),
  markRunning: (instanceId, running) =>
    set((state) => {
      const next = new Set(state.runningInstanceIds);
      running ? next.add(instanceId) : next.delete(instanceId);
      return { runningInstanceIds: next };
    }),
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
}));
