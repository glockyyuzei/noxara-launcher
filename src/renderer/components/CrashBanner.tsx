import { Copy, AlertTriangle, RotateCcw, TerminalSquare, Wrench, X } from "lucide-react";
import type { CrashInfo } from "@shared/types/ipc";
import type { ConsoleLine } from "../stores/useLaunchStore";

/**
 * Shown when an instance crashed. The diagnosis (analyzeCrash) drives the copy,
 * and the actions are real: view the console, retry the launch, or run a repair.
 */
export function CrashBanner({
  info,
  logs,
  onViewLog,
  onRestart,
  onRepair,
  onDismiss,
}: {
  info: CrashInfo;
  logs: ConsoleLine[];
  onViewLog: () => void;
  onRestart: () => void;
  onRepair: () => void;
  onDismiss: () => void;
}) {
  const copyError = () => {
    const text = logs
      .slice(-400)
      .map((l) => l.line)
      .join("\n");
    navigator.clipboard.writeText(
      `Noxara — ${info.patternId}${info.exitCode !== null ? ` (exit code ${info.exitCode})` : ""}\n\n${info.reason}\n${info.hint}${info.detail ? `\n\n${info.detail}` : ""}\n\n--- console (tail) ---\n${text}`
    );
  };

  return (
    <div className="mb-6 yz-card border-noxara-error/40 bg-noxara-error/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex items-start gap-3">
          <AlertTriangle size={18} className="text-noxara-error shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-sm font-semibold text-noxara-error">Minecraft crashed</div>
            <p className="text-sm text-noxara-text mt-1">{info.reason}</p>
            <p className="text-xs text-noxara-muted mt-0.5">{info.hint}</p>
            {info.detail && (
              <p className="text-xs font-mono text-noxara-muted mt-2 truncate" title={info.detail}>
                {info.detail}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="text-noxara-muted hover:text-noxara-text shrink-0"
          aria-label="Dismiss"
        >
          <X size={15} />
        </button>
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        <button onClick={copyError} className="yz-btn-secondary text-xs px-2.5 py-1.5">
          <Copy size={13} /> Copy error
        </button>
        <button onClick={onViewLog} className="yz-btn-secondary text-xs px-2.5 py-1.5">
          <TerminalSquare size={13} /> View log
        </button>
        <button onClick={onRestart} className="yz-btn-primary text-xs px-2.5 py-1.5">
          <RotateCcw size={13} /> Restart
        </button>
        <button onClick={onRepair} className="yz-btn-secondary text-xs px-2.5 py-1.5">
          <Wrench size={13} /> Repair
        </button>
      </div>
    </div>
  );
}