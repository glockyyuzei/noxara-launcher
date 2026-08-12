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
  gameVersion: string | "all";
  hits: ModrinthSearchHit[];
  totalHits: number;
  offset: number;
  limit: number;
  searching: boolean;
  searchError: string | null;

  // Installed mods, keyed by instance id
  installedByInstance: Record<string, InstalledMod[]>;
  installingKeys: Set<string>; // `${instanceId}:${projectId}`
  updatesByInstance: Record<string, ModUpdateInfo[]>;

  setQuery: (q: string) => void;
  setLoader: (l: ModLoader | "all") => void;
  setSort: (s: ModSearchSort) => void;
  setGameVersion: (v: string | "all") => void;
  search: (offset?: number) => Promise<void>;
  nextPage: () => Promise<void>;
  prevPage: () => Promise<void>;

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
  gameVersion: "all",
  hits: [],
  totalHits: 0,
  offset: 0,
  limit: 20,
  searching: false,
  searchError: null,

  installedByInstance: {},
  installingKeys: new Set(),
  updatesByInstance: {},

  setQuery: (query) => set({ query, offset: 0 }),
  setLoader: (loader) => set({ loader, offset: 0 }),
  setSort: (sort) => set({ sort, offset: 0 }),
  setGameVersion: (gameVersion) => set({ gameVersion, offset: 0 }),

  search: async (offsetOverride) => {
    const token = ++searchToken;
    const { query, loader, sort, limit, gameVersion } = get();
    const offset = offsetOverride ?? get().offset;
    set({ searching: true, searchError: null, offset });
    try {
      const result = await window.noxara.searchMods({
        query,
        loader: loader === "all" ? undefined : loader,
        gameVersion: gameVersion === "all" ? undefined : gameVersion,
        sort,
        limit,
        offset,
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

  nextPage: async () => {
    const { offset, limit, totalHits } = get();
    if (offset + limit >= totalHits) return;
    await get().search(offset + limit);
  },

  prevPage: async () => {
    const { offset, limit } = get();
    await get().search(Math.max(0, offset - limit));
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
