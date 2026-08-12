import { CheckCircle2, AlertTriangle, Loader2, Hammer, Download, FolderOpen } from "lucide-react";
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

function ActiveDownloadRow({ d }: { d: DownloadEntry }) {
  const meta = d.kind === "batch" && (d.fileCount ?? 0) > 1 ? ` · ${d.fileIndex}/${d.fileCount} file${(d.fileCount ?? 0) > 1 ? "s" : ""}` : "";
  const speed = formatSpeed(d.bytesPerSec);
  const eta = formatEta(d.etaSeconds);
  const showCounts = d.kind === "batch" && d.totalBytes > 0;

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
        <span className="shrink-0 tabular-nums">
          {speed && <span>{speed}</span>}
          {speed && eta && <span> · </span>}
          {eta && <span>ETA {eta}</span>}
        </span>
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

function FinishedRow({ d }: { d: DownloadEntry }) {
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
          {d.status === "failed" && (
            <div className="text-xs text-noxara-muted mt-0.5">The originating action can be retried from its page.</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DownloadsPage() {
  const downloads = useDownloadStore((s) => s.downloads);
  const forgeInstalls = useDownloadStore((s) => s.forgeInstalls);
  const clearCompleted = useDownloadStore((s) => s.clearCompleted);

  const active = selectActiveDownloads(downloads);
  const finished = selectFinishedDownloads(downloads);
  const activeForge = forgeInstalls.filter((f) => f.status === "installing");
  const finishedForge = forgeInstalls.filter((f) => f.status === "complete");

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
            <ActiveDownloadRow key={d.taskId} d={d} />
          ))}

          {finishedForge.map((f) => (
            <LoaderInstallRow key={f.taskId} taskId={f.taskId} stage={f.stage} message={f.message} status={f.status} />
          ))}

          {finished.map((d) => (
            <FinishedRow key={d.taskId} d={d} />
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