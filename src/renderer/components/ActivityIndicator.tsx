import { Loader2 } from "lucide-react";
import type { ActivityRecord } from "@shared/types/ipc";

/**
 * Collapsed state of the global activity overlay: a compact pill showing the number
 * of in-flight operations and a spinner. Clicking expands the full panel.
 */
export function ActivityIndicator({
  activeCount,
  recentCount,
  onExpand,
}: {
  activeCount: number;
  recentCount: number;
  onExpand: () => void;
}) {
  return (
    <button
      onClick={onExpand}
      aria-label={`${activeCount} activity in progress — expand`}
      className="group inline-flex items-center gap-2 rounded-full border border-noxara-border bg-noxara-surface/95
        backdrop-blur px-3.5 py-2 shadow-lg shadow-black/40 hover:border-noxara-border-strong
        hover:bg-noxara-elevated transition-all duration-150 active:scale-[0.98]"
    >
      <Loader2 size={15} className="text-noxara-white animate-spin" />
      <span className="text-xs font-medium text-noxara-text tabular-nums">
        {activeCount} {activeCount === 1 ? "activity" : "activities"}
      </span>
      {recentCount > 0 && (
        <span className="text-[11px] text-noxara-muted tabular-nums">{recentCount} done</span>
      )}
    </button>
  );
}

/** Convenience used by ActivityOverlay to read the active subset. */
export function selectActive(activities: ActivityRecord[]): ActivityRecord[] {
  return activities.filter((a) => a.status !== "completed" && a.status !== "failed" && a.status !== "cancelled");
}