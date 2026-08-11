import { create } from "zustand";
import type {
  InstalledMod,
  ModLoader,
  ModrinthSearchHit,
  ModSearchSort,
  ModUpdateInfo,
} from "@shared/types/ipc";

interface ModState {
  // Browse (Modrinth search)
  query: string;
  loader: ModLoader | "all";
  sort: ModSearchSort;
  hits: ModrinthSearchHit[];
  totalHits: number;
  searching: boolean;
  searchError: string | null;

  // Installed mods, keyed by instance id
  installedByInstance: Record<string, InstalledMod[]>;
  installingKeys: Set<string>; // `${instanceId}:${projectId}`
  updatesByInstance: Record<string, ModUpdateInfo[]>;

  setQuery: (q: string) => void;
  setLoader: (l: ModLoader | "all") => void;
  setSort: (s: ModSearchSort) => void;
  search: () => Promise<void>;

  refreshInstalled: (instanceId: string) => Promise<void>;
  install: (instanceId: string, projectId: string, versionId: string) => Promise<void>;
  remove: (instanceId: string, modId: string) => Promise<void>;
  checkUpdates: (instanceId: string) => Promise<void>;
}

let searchToken = 0;

export const useModStore = create<ModState>((set, get) => ({
  query: "",
  loader: "all",
  sort: "relevance",
  hits: [],
  totalHits: 0,
  searching: false,
  searchError: null,

  installedByInstance: {},
  installingKeys: new Set(),
  updatesByInstance: {},

  setQuery: (query) => set({ query }),
  setLoader: (loader) => set({ loader }),
  setSort: (sort) => set({ sort }),

  search: async () => {
    const token = ++searchToken;
    const { query, loader, sort } = get();
    set({ searching: true, searchError: null });
    try {
      const result = await window.noxara.searchMods({
        query,
        loader: loader === "all" ? undefined : loader,
        sort,
        limit: 20,
      });
      if (token !== searchToken) return; // a newer search superseded this one
      set({ hits: result.hits, totalHits: result.totalHits, searching: false });
    } catch (e) {
      if (token !== searchToken) return;
      set({
        searching: false,
        searchError: e instanceof Error ? e.message : "Search failed",
        hits: [],
      });
    }
  },

  refreshInstalled: async (instanceId) => {
    const mods = await window.noxara.listInstalledMods(instanceId);
    set((state) => ({ installedByInstance: { ...state.installedByInstance, [instanceId]: mods } }));
  },

  install: async (instanceId, projectId, versionId) => {
    const key = `${instanceId}:${projectId}`;
    set((state) => ({ installingKeys: new Set(state.installingKeys).add(key) }));
    try {
      await window.noxara.installMod(instanceId, projectId, versionId);
      await get().refreshInstalled(instanceId);
    } finally {
      set((state) => {
        const next = new Set(state.installingKeys);
        next.delete(key);
        return { installingKeys: next };
      });
    }
  },

  remove: async (instanceId, modId) => {
    await window.noxara.removeMod(instanceId, modId);
    await get().refreshInstalled(instanceId);
  },

  checkUpdates: async (instanceId) => {
    const updates = await window.noxara.checkModUpdates(instanceId);
    set((state) => ({ updatesByInstance: { ...state.updatesByInstance, [instanceId]: updates } }));
  },
}));
