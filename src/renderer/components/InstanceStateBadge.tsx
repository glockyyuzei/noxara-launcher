import { Loader2, Play, AlertTriangle } from "lucide-react";
import type { InstanceState } from "@shared/types/ipc";
import { useInstanceState } from "../stores/useInstanceState";

const STATE_META: Record<InstanceState, { label: string; color: string; icon?: "spinner" | "play" | "alert" }> = {
  RUNNING: { label: "RUNNING", color: "text-noxara-success", icon: "play" },
  STOPPING: { label: "STOPPING", color: "text-noxara-text", icon: "spinner" },
  LAUNCHING: { label: "LAUNCHING", color: "text-noxara-text", icon: "spinner" },
  DOWNLOADING: { label: "DOWNLOADING", color: "text-noxara-text", icon: "spinner" },
  INSTALLING: { label: "INSTALLING", color: "text-noxara-text", icon: "spinner" },
  CREATING: { label: "CREATING", color: "text-noxara-text", icon: "spinner" },
  CRASHED: { label: "CRASHED", color: "text-noxara-error", icon: "alert" },
  ERROR: { label: "ERROR", color: "text-noxara-error", icon: "alert" },
  READY: { label: "READY", color: "", icon: undefined },
};

/** The instance's real lifecycle state as a compact badge. READY renders nothing.
 * The dark pill reads over both cover art and page backgrounds. */
export function InstanceStateBadge({ instanceId }: { instanceId: string }) {
  const state = useInstanceState(instanceId);
  const meta = STATE_META[state];
  if (!meta.color) return null;
  return (
    <span
      className={`flex items-center gap-1 text-[9px] font-medium bg-black/70 backdrop-blur-sm px-1.5 py-0.5 rounded ${meta.color}`}
    >
      {meta.icon === "play" && <Play size={8} fill="currentColor" />}
      {meta.icon === "spinner" && <Loader2 size={8} className="animate-spin" />}
      {meta.icon === "alert" && <AlertTriangle size={8} />}
      {meta.label}
    </span>
  );
}