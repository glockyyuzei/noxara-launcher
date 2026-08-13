import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  FolderOpen,
  Hammer,
  Image,
  Package,
  RotateCcw,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { useActivityStore, selectRecent } from "../stores/useActivityStore";
import { selectActive } from "../components/ActivityIndicator";
import { formatBytes, formatSpeed, formatEta } from "../utils/format";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { toast } from "../stores/useToastStore";
import type { ActivityRecord, ActivityType } from "@shared/types/ipc";

const TYPE_ICONS: Record<ActivityType, typeof Package> = {
  minecraft: Download,
  mod: Package,
  content: Image,
  modpack: Archive,
  loader: Wrench,
  instance: FolderOpen,
  backup: FolderOpen,
};

function percentOf(a: ActivityRecord): number {
  const { progress } = a;
  const pct = progress.progress;
  if (pct !== undefined && pct >= 0) {
    return Math.round(Math.min(1, pct) * 100);
  }
  const total = progress.totalBytes ?? 0;
  const current = progress.currentBytes ?? 0;
  if (total > 0) {
    return Math.round((current / total) * 100);
  }
  return 90;
}

function ProgressBar({ percent, tone = "default" }: { percent: number; tone?: "default" | "error" }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="h-1.5 rounded-full bg-noxara-elevated overflow-hidden">
      <div
        className={`h-full rounded-full transition-[width] duration-300 ease-out ${
          tone === "error" ? "bg-noxara-error" : "bg-noxara-white"
        }`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function metaLine(a: ActivityRecord): string {
  const { progress } = a;
  const parts: string[] = [];
  if (progress.completedFiles !== undefined && progress.totalFiles !== undefined && progress.totalFiles > 0) {
    parts.push(`file ${progress.completedFiles}/${progress.totalFiles}`);
  } else {
    const total = progress.totalBytes ?? 0;
    const current = progress.currentBytes ?? 0;
    if (total > 0) {
      parts.push(`${formatBytes(current)} / ${formatBytes(total)}`);
    } else if (current > 0) {
      parts.push(formatBytes(current));
    }
  }
  if (progress.currentFile) parts.push(progress.currentFile);
  return parts.join(" · ");
}

function ActiveRow({ a, onCancel }: { a: ActivityRecord; onCancel: (id: string) => void }) {
  const Icon = a.type === "loader" ? Hammer : TYPE_ICONS[a.type];
  const speed = formatSpeed(a.progress.speedBytesPerSec);
  const eta = formatEta(a.progress.etaSeconds);
  const meta = metaLine(a);

  return (
    <div className="yz-card px-4 py-3">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-2 text-sm text-noxara-text min-w-0">
          <Icon size={14} className={`${a.type === "loader" ? "text-noxara-subtle animate-pulse" : "text-noxara-subtle animate-spin"} shrink-0`} />
          <span className="truncate">{a.title}</span>
        </div>
        <span className="text-xs text-noxara-muted shrink-0 tabular-nums">
          {meta || (a.description ?? "Working…")}
        </span>
      </div>
      <ProgressBar percent={percentOf(a)} tone={a.status === "failed" ? "error" : "default"} />
      <div className="flex items-center justify-between mt-1.5 text-[11px] text-noxara-muted">
        <span className="truncate">{a.description ?? progressLabel(a)}</span>
        <div className="flex items-center gap-3 shrink-0">
          <span className="tabular-nums">
            {speed && <span>{speed}</span>}
            {speed && eta && <span> · </span>}
            {eta && <span>ETA {eta}</span>}
          </span>
          {a.cancellable && (
            <button
              onClick={() => onCancel(a.id)}
              className="flex items-center gap-1 text-[11px] text-noxara-muted hover:text-noxara-error transition-colors"
              aria-label={`Cancel ${a.title}`}
            >
              <X size={12} /> Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function progressLabel(a: ActivityRecord): string {
  const percent = percentOf(a);
  if (a.progress.progress !== undefined || (a.progress.totalBytes ?? 0) > 0) return `${percent}%`;
  return "In progress…";
}

function FinishedRow({ a, onRetry }: { a: ActivityRecord; onRetry: (id: string) => void }) {
  return (
    <div
      className={`yz-card px-4 py-3 flex items-center justify-between gap-3 ${
        a.status === "failed" ? "border-noxara-error/30" : ""
      }`}
    >
      <div className="flex items-center gap-2 text-sm min-w-0">
        {a.status === "completed" ? (
          <CheckCircle2 size={15} className="text-noxara-success shrink-0" />
        ) : a.status === "cancelled" ? (
          <XCircle size={15} className="text-noxara-warning shrink-0" />
        ) : (
          <AlertTriangle size={15} className="text-noxara-error shrink-0" />
        )}
        <div className="min-w-0">
          <div className="text-noxara-text truncate">{a.title}</div>
          {a.error && <div className="text-xs text-noxara-error mt-0.5 truncate">{a.error}</div>}
          {a.description && a.status === "completed" && (
            <div className="text-xs text-noxara-muted mt-0.5 truncate">{a.description}</div>
          )}
          {a.status === "failed" && !a.retryable && (
            <div className="text-xs text-noxara-muted mt-0.5">The originating action can be retried from its page.</div>
          )}
        </div>
      </div>
      {a.status === "failed" && a.retryable && (
        <button
          onClick={() => onRetry(a.id)}
          className="yz-btn-secondary text-xs px-2.5 py-1 shrink-0"
          aria-label={`Retry ${a.title}`}
        >
          <RotateCcw size={12} /> Retry
        </button>
      )}
    </div>
  );
}

export default function DownloadsPage() {
  const activities = useActivityStore((s) => s.activities);
  const clearCompleted = useActivityStore((s) => s.clearCompleted);

  const active = selectActive(activities);
  const recent = selectRecent(activities);
  const isEmpty = activities.length === 0;

  async function handleCancel(id: string) {
    try {
      await window.noxara.cancelActivity(id);
      toast.success("Operation cancelled", "You can retry it from this page.");
    } catch (e) {
      toast.error("Couldn't cancel", e instanceof Error ? e.message : undefined);
    }
  }

  async function handleRetry(id: string) {
    try {
      await window.noxara.retryActivity(id);
    } catch (e) {
      toast.error("Couldn't retry", e instanceof Error ? e.message : undefined);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <PageHeader
        title="Downloads"
        subtitle="Mods, content, Minecraft files, loader installs, and repairs."
        actions={
          recent.length > 0 && (
            <button onClick={clearCompleted} className="yz-btn-ghost text-xs">
              Clear finished
            </button>
          )
        }
      />

      {isEmpty ? (
        <EmptyState
          icon={Download}
          title="No activity"
          description="Mod, modpack, resource pack, shader, Minecraft file downloads, and repairs will show up here."
        />
      ) : (
        <div className="space-y-2">
          {active.map((a) => (
            <ActiveRow key={a.id} a={a} onCancel={handleCancel} />
          ))}

          {recent.map((a) => (
            <FinishedRow key={a.id} a={a} onRetry={handleRetry} />
          ))}
        </div>
      )}

      {active.length > 0 && (
        <div className="mt-4 flex items-center justify-between text-xs text-noxara-muted">
          <span className="inline-flex items-center gap-1.5">
            <FolderOpen size={13} /> {active.length} active operation{active.length > 1 ? "s" : ""}
          </span>
          <span>Shows real launcher progress.</span>
        </div>
      )}
    </div>
  );
}