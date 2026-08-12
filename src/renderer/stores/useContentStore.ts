import { create } from "zustand";
import type {
  ContentCategory,
  InstalledContent,
  ModLoader,
  ModrinthSearchHit,
  ModSearchSort,
} from "@shared/types/ipc";

interface BrowseState {
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
  installedByInstance: Record<string, InstalledContent[]>;
  installingKeys: Set<string>; // `${category}:${instanceId}:${projectId}`
}

interface ContentState extends BrowseState {
  setQuery: (q: string) => void;
  setLoader: (l: ModLoader | "all") => void;
  setSort: (s: ModSearchSort) => void;
  setGameVersion: (v: string | "all") => void;
  /** Resets the shared browse state so navigating to a different category never
   * carries another section's query/filters/results across. */
  resetBrowse: () => void;
  search: (category: ContentCategory, offset?: number) => Promise<void>;
  nextPage: (category: ContentCategory) => Promise<void>;
  prevPage: (category: ContentCategory) => Promise<void>;
  refreshInstalled: (instanceId: string, category: ContentCategory) => Promise<void>;
  install: (instanceId: string, projectId: string, versionId: string, category: ContentCategory) => Promise<void>;
  remove: (instanceId: string, itemId: string, category: ContentCategory) => Promise<void>;
  setEnabled: (instanceId: string, itemId: string, category: ContentCategory, enabled: boolean) => Promise<void>;
}

let searchToken = 0;

export const useContentStore = create<ContentState>((set, get) => ({
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

  setQuery: (query) => set({ query, offset: 0 }),
  setLoader: (loader) => set({ loader, offset: 0 }),
  setSort: (sort) => set({ sort, offset: 0 }),
  setGameVersion: (gameVersion) => set({ gameVersion, offset: 0 }),
  resetBrowse: () =>
    set({
      query: "",
      loader: "all",
      sort: "relevance",
      gameVersion: "all",
      hits: [],
      totalHits: 0,
      offset: 0,
      searching: false,
      searchError: null,
    }),

  search: async (category, offsetOverride) => {
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
        projectType: category,
      });
      if (token !== searchToken) return;
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

  nextPage: async (category) => {
    const { offset, limit, totalHits } = get();
    if (offset + limit >= totalHits) return;
    await get().search(category, offset + limit);
  },

  prevPage: async (category) => {
    const { offset, limit } = get();
    await get().search(category, Math.max(0, offset - limit));
  },

  refreshInstalled: async (instanceId, category) => {
    const items = await window.noxara.listInstalledContent(instanceId, category);
    set((state) => ({
      installedByInstance: {
        ...state.installedByInstance,
        [`${instanceId}:${category}`]: items,
      },
    }));
  },

  install: async (instanceId, projectId, versionId, category) => {
    const key = `${category}:${instanceId}:${projectId}`;
    set((state) => ({ installingKeys: new Set(state.installingKeys).add(key) }));
    try {
      await window.noxara.installContent(instanceId, versionId, category);
      await get().refreshInstalled(instanceId, category);
    } finally {
      set((state) => {
        const next = new Set(state.installingKeys);
        next.delete(key);
        return { installingKeys: next };
      });
    }
  },

  remove: async (instanceId, itemId, category) => {
    await window.noxara.removeContent(instanceId, itemId, category);
    await get().refreshInstalled(instanceId, category);
  },

  setEnabled: async (instanceId, itemId, category, enabled) => {
    await window.noxara.setContentEnabled(instanceId, itemId, category, enabled);
    await get().refreshInstalled(instanceId, category);
  },
}));

/** Convenience selector: installed items for a given instance + category. */
export function selectInstalledContent(
  installedByInstance: Record<string, InstalledContent[]>,
  instanceId: string,
  category: ContentCategory
): InstalledContent[] {
  return installedByInstance[`${instanceId}:${category}`] ?? [];
}
