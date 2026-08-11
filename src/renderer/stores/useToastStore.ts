import { create } from "zustand";

export type ToastVariant = "success" | "error" | "info";

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
}

interface ToastState {
  toasts: ToastItem[];
  push: (toast: Omit<ToastItem, "id">) => string;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) => {
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [...state.toasts, { ...toast, id }] }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience helpers so call sites read `toast.success("Account switched")`. */
export const toast = {
  success: (title: string, description?: string) =>
    useToastStore.getState().push({ variant: "success", title, description }),
  error: (title: string, description?: string) =>
    useToastStore.getState().push({ variant: "error", title, description }),
  info: (title: string, description?: string) =>
    useToastStore.getState().push({ variant: "info", title, description }),
};
