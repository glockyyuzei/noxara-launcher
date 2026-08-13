import { useEffect, useState } from "react";
import { HardDrive, RefreshCw, Trash2, Loader2 } from "lucide-react";
import type { StorageBreakdown } from "@shared/types/ipc";
import { PageHeader } from "../components/PageHeader";
import { formatBytes } from "../utils/format";
import { toast } from "../stores/useToastStore";

export default function StoragePage() {
  const [breakdown, setBreakdown] = useState<StorageBreakdown | null>(null);
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setBreakdown(await window.noxara.getStorageBreakdown());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't scan storage");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleClear(categoryId: string) {
    const category = breakdown?.categories.find((c) => c.id === categoryId);
    if (!category) return;
    if (!window.confirm(`Clear "${category.label}"?\n\n${category.hint}`)) return;
    setClearing(categoryId);
    try {
      const fresh = await window.noxara.clearStorageCache(categoryId);
      setBreakdown(fresh);
      toast.success("Cleared", category.label);
    } catch (e) {
      toast.error("Couldn't clear", e instanceof Error ? e.message : undefined);
    } finally {
      setClearing(null);
    }
  }

  if (loading && !breakdown) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <PageHeader title="Storage" subtitle="See how the launcher uses your disk and clear regenerable caches." />
        <div className="space-y-2.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="yz-skeleton h-14 rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <PageHeader title="Storage" subtitle="See how the launcher uses your disk and clear regenerable caches." />
        <div className="yz-card px-4 py-6 text-center">
          <p className="text-sm text-noxara-error">{error}</p>
          <button onClick={refresh} className="yz-btn-secondary text-xs mt-3">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!breakdown) return null;

  const total = breakdown.totalBytes;
  const diskUsedPct =
    breakdown.diskTotalBytes > 0
      ? Math.min(100, Math.round(((breakdown.diskTotalBytes - breakdown.diskFreeBytes) / breakdown.diskTotalBytes) * 100))
      : 0;
  const maxSize = Math.max(...breakdown.categories.map((c) => c.sizeBytes), 1);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <PageHeader title="Storage" subtitle="See how the launcher uses your disk and clear regenerable caches." />

      <div className="flex items-center justify-between mb-4">
        <button onClick={refresh} className="yz-btn-ghost text-xs flex items-center gap-1.5">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <div className="yz-card px-4 py-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <HardDrive size={16} className="text-noxara-muted" />
            <span className="text-sm text-noxara-text">Total launcher data</span>
          </div>
          <span className="text-sm font-medium text-noxara-text">{formatBytes(total)}</span>
        </div>
        {breakdown.diskTotalBytes > 0 && (
          <div className="mt-3 pt-3 border-t border-noxara-border">
            <div className="flex justify-between text-xs text-noxara-muted mb-1.5">
              <span>Drive usage</span>
              <span>
                {formatBytes(breakdown.diskTotalBytes - breakdown.diskFreeBytes)} used of{" "}
                {formatBytes(breakdown.diskTotalBytes)} ({diskUsedPct}%) · {formatBytes(breakdown.diskFreeBytes)} free
              </span>
            </div>
            <div className="h-2 rounded bg-noxara-elevated overflow-hidden">
              <div className="h-full bg-noxara-accent" style={{ width: `${diskUsedPct}%` }} />
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2.5">
        {breakdown.categories.map((c) => {
          const pct = Math.round((c.sizeBytes / maxSize) * 100);
          return (
            <div key={c.id} className="yz-card px-4 py-3">
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <div className="min-w-0">
                  <div className="text-sm text-noxara-text">{c.label}</div>
                  <div className="text-[11px] text-noxara-muted truncate">{c.hint}</div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-sm text-noxara-text tabular-nums">{formatBytes(c.sizeBytes)}</span>
                  {c.clearable ? (
                    <button
                      onClick={() => handleClear(c.id)}
                      disabled={clearing === c.id}
                      className="yz-btn-ghost text-xs px-2 py-1 flex items-center gap-1 text-noxara-error disabled:opacity-40"
                    >
                      {clearing === c.id ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      Clear
                    </button>
                  ) : (
                    <span className="text-[11px] text-noxara-subtle shrink-0">User data</span>
                  )}
                </div>
              </div>
              <div className="h-1.5 rounded bg-noxara-elevated overflow-hidden">
                <div
                  className="h-full bg-noxara-subtle"
                  style={{ width: `${c.sizeBytes === 0 ? 0 : Math.max(pct, 2)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}