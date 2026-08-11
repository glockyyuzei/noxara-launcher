import { create } from "zustand";
import type { AccountRecord } from "@shared/types/ipc";

/**
 * Single source of truth for account list + active account, shared across
 * Sidebar / AccountSelector / HomePage / AccountsPage.
 *
 * Root cause this fixes: every consumer used to call window.noxara.listAccounts()
 * into its own local useState on mount. Creating or switching an account in one
 * screen (e.g. AccountsPage) never reached the others (e.g. the bottom-left
 * selector), so a freshly created offline account could exist in the DB but
 * never *look* selectable anywhere outside the page that created it.
 *
 * This store does not touch account creation/auth/persistence logic at all —
 * it only calls the existing window.noxara IPC methods and fans the result out.
 */
interface AccountState {
  accounts: AccountRecord[];
  loading: boolean;
  error: string | null;
  hasLoaded: boolean;
  activeAccount: () => AccountRecord | null;
  refresh: () => Promise<void>;
  switchAccount: (id: string) => Promise<void>;
  createOffline: (username: string) => Promise<AccountRecord>;
  remove: (id: string) => Promise<void>;
}

export const useAccountStore = create<AccountState>((set, get) => ({
  accounts: [],
  loading: false,
  error: null,
  hasLoaded: false,

  activeAccount: () => get().accounts.find((a) => a.isActive) ?? null,

  refresh: async () => {
    set({ loading: true, error: null });
    try {
      const accounts = await window.noxara.listAccounts();
      set({ accounts, loading: false, hasLoaded: true });
    } catch (e) {
      set({
        loading: false,
        hasLoaded: true,
        error: e instanceof Error ? e.message : "Failed to load accounts",
      });
    }
  },

  switchAccount: async (id: string) => {
    // Optimistic update so the UI feels instant, corrected by the refresh below.
    set((state) => ({
      accounts: state.accounts.map((a) => ({ ...a, isActive: a.id === id })),
    }));
    await window.noxara.setActiveAccount(id);
    await get().refresh();
  },

  createOffline: async (username: string) => {
    const account = await window.noxara.createOfflineProfile(username);
    await get().refresh();
    return account;
  },

  remove: async (id: string) => {
    await window.noxara.removeAccount(id);
    await get().refresh();
  },
}));
