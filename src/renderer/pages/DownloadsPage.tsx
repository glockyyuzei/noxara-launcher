import { CheckCircle2, AlertTriangle, Loader2, Hammer } from "lucide-react";
import { useDownloadStore } from "../stores/useDownloadStore";

function formatBytes(n: number): string {
  if (n <= 0) return "0 MB";
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
}

export default function DownloadsPage() {
  const downloads = useDownloadStore((s) => s.downloads);
  const forgeInstalls = useDownloadStore((s) => s.forgeInstalls);
  const clearCompleted = useDownloadStore((s) => s.clearCompleted);

  const active = downloads.filter((d) => d.status === "downloading");
  const finished = downloads.filter((d) => d.status !== "downloading");
  const activeForge = forgeInstalls.filter((f) => f.status === "installing");
  const finishedForge = forgeInstalls.filter((f) => f.status === "complete");

  const isEmpty = downloads.length === 0 && forgeInstalls.length === 0;

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl md:text-2xl font-semibold text-noxara-white">Downloads</h1>
          <p className="text-sm text-noxara-muted mt-1">Mods, Forge installs, and other launcher downloads.</p>
        </div>
        {(finished.length > 0 || finishedForge.length > 0) && (
          <button onClick={clearCompleted} className="yz-btn-ghost text-xs">
            Clear finished
          </button>
        )}
      </div>

      {isEmpty ? (
        <div className="yz-card p-10 text-center text-sm text-noxara-muted">No active downloads.</div>
      ) : (
        <div className="space-y-2">
          {activeForge.map((f) => (
            <div key={f.taskId} className="yz-card px-4 py-3">
              <div className="flex items-center gap-2 mb-2 text-sm text-noxara-text">
                <Hammer size={14} className="text-noxara-subtle animate-pulse" />
                Installing Forge
              </div>
              <div className="text-xs text-noxara-muted truncate">{f.message}</div>
            </div>
          ))}

          {active.map((d) => {
            const pct = d.totalBytes > 0 ? Math.round((d.bytesDownloaded / d.totalBytes) * 100) : 0;
            return (
              <div key={d.taskId} className="yz-card px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-sm text-noxara-text">
                    <Loader2 size={14} className="animate-spin text-noxara-subtle" />
                    {d.modName}
                  </div>
                  <span className="text-xs text-noxara-muted">
                    {formatBytes(d.bytesDownloaded)}
                    {d.totalBytes > 0 ? ` / ${formatBytes(d.totalBytes)}` : ""}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-noxara-elevated overflow-hidden">
                  <div
                    className="h-full bg-noxara-white transition-[width] duration-200 ease-out"
                    style={{ width: `${d.totalBytes > 0 ? pct : 30}%` }}
                  />
                </div>
              </div>
            );
          })}

          {finishedForge.map((f) => (
            <div key={f.taskId} className="yz-card px-4 py-3 flex items-center gap-2">
              <CheckCircle2 size={15} className="text-noxara-success" />
              <div className="text-sm text-noxara-text">Forge installed</div>
            </div>
          ))}

          {finished.map((d) => (
            <div
              key={d.taskId}
              className={`yz-card px-4 py-3 flex items-center justify-between ${
                d.status === "failed" ? "border-noxara-error/30" : ""
              }`}
            >
              <div className="flex items-center gap-2 text-sm">
                {d.status === "completed" ? (
                  <CheckCircle2 size={15} className="text-noxara-success" />
                ) : (
                  <AlertTriangle size={15} className="text-noxara-error" />
                )}
                <div>
                  <div className="text-noxara-text">{d.modName}</div>
                  {d.error && <div className="text-xs text-noxara-error mt-0.5">{d.error}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
