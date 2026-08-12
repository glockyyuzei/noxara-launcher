import { CheckCircle2, AlertTriangle, Loader2, Hammer, Download, FolderOpen, RotateCcw, X } from "lucide-react";
import {
  useDownloadStore,
  selectActiveDownloads,
  selectFinishedDownloads,
  formatBytes,
  formatSpeed,
  formatEta,
  type DownloadEntry,
} from "../stores/useDownloadStore";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { toast } from "../stores/useToastStore";

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

function percentOf(d: DownloadEntry): number {
  if (d.totalBytes > 0) return Math.round((d.bytesDownloaded / d.totalBytes) * 100);
  // No known total size — show indeterminate progress capped at 90% until complete.
  return d.status === "downloading" ? 90 : 100;
}

function ActiveDownloadRow({ d, onCancel }: { d: DownloadEntry; onCancel: (taskId: string) => void }) {
  const meta = d.kind === "batch" && (d.fileCount ?? 0) > 1 ? ` · ${d.fileIndex}/${d.fileCount} file${(d.fileCount ?? 0) > 1 ? "s" : ""}` : "";
  const speed = formatSpeed(d.bytesPerSec);
  const eta = formatEta(d.etaSeconds);
  const showCounts = d.kind === "batch" && d.totalBytes > 0;
  // Only single-file mod/content downloads are user-interruptible; batch downloads
  // (client jars, libraries, assets) are part of an atomic launch/install operation.
  const cancellable = d.kind === "mod" || d.kind === "content";

  return (
    <div className="yz-card px-4 py-3">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-2 text-sm text-noxara-text min-w-0">
          <Loader2 size={14} className="animate-spin text-noxara-subtle shrink-0" />
          <span className="truncate">{d.name}</span>
        </div>
        <span className="text-xs text-noxara-muted shrink-0 tabular-nums">
          {d.kind === "batch" ? (
            <>
              {showCounts ? `${formatBytes(d.bytesDownloaded)} / ${formatBytes(d.totalBytes)}` : formatBytes(d.bytesDownloaded)}
              {meta}
            </>
          ) : (
            <>
              {formatBytes(d.bytesDownloaded)}
              {d.totalBytes > 0 ? ` / ${formatBytes(d.totalBytes)}` : ""}
            </>
          )}
        </span>
      </div>
      <ProgressBar percent={percentOf(d)} />
      <div className="flex items-center justify-between mt-1.5 text-[11px] text-noxara-muted">
        <span className="truncate">
          {d.status === "completed"
            ? "Completed"
            : showCounts
              ? `Overall progress · ${percentOf(d)}%`
              : d.totalBytes > 0
                ? `${percentOf(d)}%`
                : "Downloading…"}
        </span>
        <div className="flex items-center gap-3 shrink-0">
          <span className="tabular-nums">
            {speed && <span>{speed}</span>}
            {speed && eta && <span> · </span>}
            {eta && <span>ETA {eta}</span>}
          </span>
          {cancellable && (
            <button
              onClick={() => onCancel(d.taskId)}
              className="flex items-center gap-1 text-[11px] text-noxara-muted hover:text-noxara-error transition-colors"
              aria-label={`Cancel ${d.name}`}
            >
              <X size={12} /> Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function LoaderInstallRow({ taskId, stage, message, status }: { taskId: string; stage: string; message: string; status: "installing" | "complete" }) {
  if (status === "complete") {
    return (
      <div key={taskId} className="yz-card px-4 py-3 flex items-center gap-2">
        <CheckCircle2 size={15} className="text-noxara-success shrink-0" />
        <div className="text-sm text-noxara-text truncate">{message || "Loader installed"}</div>
      </div>
    );
  }
  return (
    <div key={taskId} className="yz-card px-4 py-3">
      <div className="flex items-center gap-2 mb-1.5 text-sm text-noxara-text">
        <Hammer size={14} className="text-noxara-subtle animate-pulse shrink-0" />
        <span className="truncate">{message || "Installing loader"}</span>
      </div>
      <div className="text-xs text-noxara-muted capitalize truncate">{stage || "working"}</div>
    </div>
  );
}

function FinishedRow({ d, retryable, onRetry }: { d: DownloadEntry; retryable: boolean; onRetry: (taskId: string) => void }) {
  return (
    <div
      key={d.taskId}
      className={`yz-card px-4 py-3 flex items-center justify-between gap-3 ${
        d.status === "failed" ? "border-noxara-error/30" : ""
      }`}
    >
      <div className="flex items-center gap-2 text-sm min-w-0">
        {d.status === "completed" ? (
          <CheckCircle2 size={15} className="text-noxara-success shrink-0" />
        ) : (
          <AlertTriangle size={15} className="text-noxara-error shrink-0" />
        )}
        <div className="min-w-0">
          <div className="text-noxara-text truncate">{d.name}</div>
          {d.error && <div className="text-xs text-noxara-error mt-0.5 truncate">{d.error}</div>}
          {d.status === "failed" && !retryable && (
            <div className="text-xs text-noxara-muted mt-0.5">The originating action can be retried from its page.</div>
          )}
        </div>
      </div>
      {d.status === "failed" && retryable && (
        <button
          onClick={() => onRetry(d.taskId)}
          className="yz-btn-secondary text-xs px-2.5 py-1 shrink-0"
          aria-label={`Retry ${d.name}`}
        >
          <RotateCcw size={12} /> Retry
        </button>
      )}
    </div>
  );
}

export default function DownloadsPage() {
  const downloads = useDownloadStore((s) => s.downloads);
  const forgeInstalls = useDownloadStore((s) => s.forgeInstalls);
  const retryableTaskIds = useDownloadStore((s) => s.retryableTaskIds);
  const clearCompleted = useDownloadStore((s) => s.clearCompleted);

  const active = selectActiveDownloads(downloads);
  const finished = selectFinishedDownloads(downloads);
  const activeForge = forgeInstalls.filter((f) => f.status === "installing");
  const finishedForge = forgeInstalls.filter((f) => f.status === "complete");

  async function handleCancel(taskId: string) {
    try {
      await window.noxara.cancelDownload(taskId);
      toast.success("Download cancelled", "You can retry it from this page.");
    } catch (e) {
      toast.error("Couldn't cancel download", e instanceof Error ? e.message : undefined);
    }
  }

  async function handleRetry(taskId: string) {
    try {
      await window.noxara.retryDownload(taskId);
    } catch (e) {
      toast.error("Couldn't retry download", e instanceof Error ? e.message : undefined);
    }
  }

  const isEmpty = downloads.length === 0 && forgeInstalls.length === 0;
  const hasFinished = finished.length > 0 || finishedForge.length > 0;

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <PageHeader
        title="Downloads"
        subtitle="Mods, content, Minecraft files, and loader installs."
        actions={
          hasFinished && (
            <button onClick={clearCompleted} className="yz-btn-ghost text-xs">
              Clear finished
            </button>
          )
        }
      />

      {isEmpty ? (
        <EmptyState
          icon={Download}
          title="No downloads"
          description="Mod, modpack, resource pack, shader, and Minecraft file downloads will show up here."
        />
      ) : (
        <div className="space-y-2">
          {activeForge.map((f) => (
            <LoaderInstallRow key={f.taskId} taskId={f.taskId} stage={f.stage} message={f.message} status={f.status} />
          ))}

          {active.map((d) => (
            <ActiveDownloadRow key={d.taskId} d={d} onCancel={handleCancel} />
          ))}

          {finishedForge.map((f) => (
            <LoaderInstallRow key={f.taskId} taskId={f.taskId} stage={f.stage} message={f.message} status={f.status} />
          ))}

          {finished.map((d) => (
            <FinishedRow key={d.taskId} d={d} retryable={retryableTaskIds.has(d.taskId)} onRetry={handleRetry} />
          ))}
        </div>
      )}

      {active.length > 0 && (
        <div className="mt-4 flex items-center justify-between text-xs text-noxara-muted">
          <span className="inline-flex items-center gap-1.5">
            <FolderOpen size={13} /> {active.length} active download{active.length > 1 ? "s" : ""}
          </span>
          {active.some((d) => d.totalBytes > 0) && (
            <span>Download pages show real launcher progress.</span>
          )}
        </div>
      )}
    </div>
  );
}