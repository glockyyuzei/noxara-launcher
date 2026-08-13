import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronDown,
  Download,
  Gamepad2,
  HardDrive,
  Image,
  Loader2,
  Package,
  RotateCw,
  Trash2,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { useActivityStore, selectRecent } from "../stores/useActivityStore";
import { ActivityIndicator, selectActive } from "./ActivityIndicator";
import { formatBytes, formatEta, formatSpeed } from "../utils/format";
import type { ActivityRecord, ActivityType } from "@shared/types/ipc";

const TYPE_ICONS: Record<ActivityType, typeof Package> = {
  minecraft: Download,
  mod: Package,
  content: Image,
  modpack: Archive,
  loader: Wrench,
  instance: HardDrive,
  backup: HardDrive,
};

function statusColor(status: ActivityRecord["status"]): string {
  switch (status) {
    case "completed":
      return "text-noxara-success";
    case "failed":
      return "text-noxara-error";
    case "cancelled":
      return "text-noxara-warning";
    default:
      return "text-noxara-white";
  }
}

function statusBadgeClass(status: ActivityRecord["status"]): string {
  switch (status) {
    case "completed":
      return "bg-noxara-success/10 text-noxara-success border-noxara-success/30";
    case "failed":
      return "bg-noxara-error/10 text-noxara-error border-noxara-error/30";
    case "cancelled":
      return "bg-noxara-warning/10 text-noxara-warning border-noxara-warning/30";
    default:
      return "bg-noxara-white/10 text-noxara-text border-noxara-border-strong";
  }
}

function StatusIcon({ status }: { status: ActivityRecord["status"] }) {
  const className = `shrink-0 ${statusColor(status)}`;
  switch (status) {
    case "completed":
      return <CheckCircle2 size={15} className={className} />;
    case "failed":
      return <AlertTriangle size={15} className={className} />;
    case "cancelled":
      return <XCircle size={15} className={className} />;
    default:
      return <Loader2 size={15} className={`${className} animate-spin`} />;
  }
}

/** Deterministic bar when the backend knows overall progress; indeterminate otherwise. */
function ProgressBar({ activity }: { activity: ActivityRecord }) {
  const { progress, status } = activity;
  const active = status !== "completed" && status !== "failed" && status !== "cancelled";
  const pct = progress.progress !== undefined && progress.progress >= 0 ? Math.min(100, progress.progress * 100) : null;

  if (!active) return null;

  return (
    <div className="h-1.5 w-full rounded-full bg-noxara-elevated overflow-hidden">
      {pct !== null ? (
        <div className="h-full rounded-full bg-noxara-white/80 transition-[width] duration-200" style={{ width: `${pct}%` }} />
      ) : (
        <div className="h-full w-full rounded-full bg-noxara-white/80 animate-shimmer" style={{ backgroundImage: "linear-gradient(90deg, transparent 0%, rgba(232,232,232,0.35) 50%, transparent 100%)", backgroundSize: "200% 100%" }} />
      )}
    </div>
  );
}

function progressLine(activity: ActivityRecord): string {
  const { progress } = activity;
  const parts: string[] = [];
  if (progress.completedFiles !== undefined && progress.totalFiles !== undefined && progress.totalFiles > 0) {
    parts.push(`file ${progress.completedFiles}/${progress.totalFiles}`);
  } else if (progress.currentBytes !== undefined && progress.totalBytes !== undefined && progress.totalBytes > 0) {
    parts.push(`${formatBytes(progress.currentBytes)} / ${formatBytes(progress.totalBytes)}`);
  }
  const speed = formatSpeed(progress.speedBytesPerSec);
  if (speed) parts.push(speed);
  const eta = formatEta(progress.etaSeconds);
  if (eta) parts.push(`${eta} left`);
  if (progress.currentFile) parts.push(progress.currentFile);
  return parts.join(" · ");
}

function ActivityRow({ activity, terminal }: { activity: ActivityRecord; terminal: boolean }) {
  const cancel = useActivityStore((s) => s.cancel);
  const retry = useActivityStore((s) => s.retry);
  const TypeIcon = TYPE_ICONS[activity.type];
  const terminalIcon = terminal || activity.status === "completed" || activity.status === "failed" || activity.status === "cancelled";

  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5 border-b border-noxara-border/70 last:border-b-0">
      <div className="mt-0.5 shrink-0">
        {terminalIcon ? (
          <StatusIcon status={activity.status} />
        ) : (
          <TypeIcon size={15} className="text-noxara-subtle shrink-0 mt-0.5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-noxara-text truncate">{activity.title}</span>
          {activity.instanceId && <span className="sr-only">{activity.instanceId}</span>}
        </div>
        {(activity.description || activity.error) && (
          <div className={`text-xs leading-snug mt-0.5 break-words ${activity.error ? "text-noxara-error" : "text-noxara-muted"}`}>
            {activity.error ?? activity.description}
          </div>
        )}
        <ProgressBar activity={activity} />
        {!terminalIcon && (() => {
          const line = progressLine(activity);
          return line ? (
            <div className="text-[11px] text-noxara-muted mt-1 truncate" title={line}>
              {line}
            </div>
          ) : null;
        })()}
        {terminalIcon && (
          <div className={`mt-1 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusBadgeClass(activity.status)}`}>
            {activity.status}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0 mt-0.5">
        {activity.cancellable && !terminalIcon && (
          <button
            onClick={() => cancel(activity.id)}
            aria-label="Cancel activity"
            title="Cancel"
            className="p-1 rounded text-noxara-muted hover:text-noxara-error hover:bg-noxara-error/10 transition-colors duration-150"
          >
            <X size={14} />
          </button>
        )}
        {activity.retryable && terminalIcon && (
          <button
            onClick={() => retry(activity.id)}
            aria-label="Retry activity"
            title="Retry"
            className="p-1 rounded text-noxara-muted hover:text-noxara-text hover:bg-noxara-elevated transition-colors duration-150"
          >
            <RotateCw size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

export function ActivityOverlay() {
  const activities = useActivityStore((s) => s.activities);
  const clearCompleted = useActivityStore((s) => s.clearCompleted);
  const [open, setOpen] = useState(false);
  const prevActiveIds = useRef<string[]>([]);

  const active = selectActive(activities);
  const recent = selectRecent(activities);
  const activeIds = active.map((a) => a.id).join("|");

  // Auto-open when a brand-new operation starts (never steal focus while a download
  // is already running and the user collapsed it).
  useEffect(() => {
    const started = active.filter((a) => !prevActiveIds.current.includes(a.id));
    if (started.length > 0) setOpen(true);
    prevActiveIds.current = active.map((a) => a.id);
  }, [activeIds]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-close when nothing is in flight and the panel is open.
  useEffect(() => {
    if (active.length === 0 && recent.length === 0) setOpen(false);
  }, [active.length, recent.length]);

  if (activities.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[90] flex flex-col items-end gap-2">
      {open ? (
        <div className="w-80 max-w-[calc(100vw-2rem)] yz-card shadow-popover bg-noxara-surface/95 backdrop-blur animate-modal-in overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-noxara-border">
            <div className="text-xs font-semibold uppercase tracking-wide text-noxara-subtle">
              {active.length > 0 ? `${active.length} active` : "Recent"}
            </div>
            <div className="flex items-center gap-0.5">
              {recent.length > 0 && (
                <button
                  onClick={clearCompleted}
                  aria-label="Clear completed"
                  title="Clear completed"
                  className="p-1 rounded text-noxara-muted hover:text-noxara-text hover:bg-noxara-elevated transition-colors duration-150"
                >
                  <Trash2 size={13} />
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                aria-label="Collapse"
                title="Collapse"
                className="p-1 rounded text-noxara-muted hover:text-noxara-text hover:bg-noxara-elevated transition-colors duration-150"
              >
                <ChevronDown size={15} />
              </button>
            </div>
          </div>
          <div className="max-h-[min(60vh,420px)] overflow-y-auto">
            {active.map((a) => (
              <ActivityRow key={a.id} activity={a} terminal={false} />
            ))}
            {active.length === 0 && recent.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-noxara-muted">No recent activity.</div>
            )}
            {recent.map((a) => (
              <ActivityRow key={a.id} activity={a} terminal={true} />
            ))}
          </div>
        </div>
      ) : (
        <ActivityIndicator activeCount={active.length} recentCount={recent.length} onExpand={() => setOpen(true)} />
      )}
    </div>
  );
}