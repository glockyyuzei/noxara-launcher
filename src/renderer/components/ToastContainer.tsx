import { useEffect } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { useToastStore, type ToastItem } from "../stores/useToastStore";

const ICONS: Record<ToastItem["variant"], typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
};

const ACCENTS: Record<ToastItem["variant"], string> = {
  success: "text-noxara-success border-noxara-success/30",
  error: "text-noxara-error border-noxara-error/30",
  info: "text-noxara-subtle border-noxara-border-strong",
};

function Toast({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const Icon = ICONS[item.variant];

  useEffect(() => {
    const t = setTimeout(() => dismiss(item.id), 4200);
    return () => clearTimeout(t);
  }, [item.id, dismiss]);

  return (
    <div
      role="status"
      className={`yz-card ${ACCENTS[item.variant]} w-80 max-w-[90vw] px-3.5 py-3 flex items-start gap-2.5 shadow-lg shadow-black/40 animate-toast-in`}
    >
      <Icon size={17} className="shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-noxara-text leading-snug">{item.title}</div>
        {item.description && (
          <div className="text-xs text-noxara-muted mt-0.5 leading-snug">{item.description}</div>
        )}
      </div>
      <button
        onClick={() => dismiss(item.id)}
        aria-label="Dismiss notification"
        className="shrink-0 text-noxara-muted hover:text-noxara-text transition-colors duration-150 rounded p-0.5 hover:bg-noxara-elevated"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <Toast item={t} />
        </div>
      ))}
    </div>
  );
}
