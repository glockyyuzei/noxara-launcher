import { useLaunchStore } from "./useLaunchStore";
import { useActivityStore, selectActive } from "./useActivityStore";
import type { InstanceState } from "@shared/types/ipc";

/**
 * Derives the real lifecycle state of an instance from backend signals only:
 *   * the launch store's authoritative event-driven flags (launching / running /
 *     stopping / crashed / error), reconciled against the core's process registry, and
 *     crash/error state set on real game-exit events;
 *   * the global activity registry, which reports every long-running operation the
 *     backend is genuinely performing for this instance (downloads, installs, repairs).
 *
 * Precedence (highest wins): STOPPING > RUNNING > CRASHED > ERROR > DOWNLOADING >
 * INSTALLING > CREATING > LAUNCHING > READY. The UI reacts to this value instead of
 * guessing from a "Play button was pressed" boolean.
 */
export function useInstanceState(instanceId: string): InstanceState {
  const launching = useLaunchStore((s) => s.launchingInstanceIds.has(instanceId));
  const running = useLaunchStore((s) => s.runningInstanceIds.has(instanceId));
  const stopping = useLaunchStore((s) => s.stoppingInstanceIds.has(instanceId));
  const crashed = useLaunchStore((s) => s.crashedInstanceIds.has(instanceId));
  const errored = useLaunchStore((s) => s.errorInstanceIds.has(instanceId));

  const activities = useActivityStore((s) => s.activities);
  const active = selectActive(activities).filter((a) => a.instanceId === instanceId);

  return deriveInstanceState({ launching, running, stopping, crashed, errored, active });
}

export function deriveInstanceState(input: {
  launching: boolean;
  running: boolean;
  stopping: boolean;
  crashed: boolean;
  errored: boolean;
  active: Array<{ status: string }>;
}): InstanceState {
  const { launching, running, stopping, crashed, errored, active } = input;

  // An in-flight kill always wins — the process is going away.
  const stoppingActivity = active.some((a) => a.status === "stopping");
  if (stopping || stoppingActivity) return "STOPPING";

  if (running) return "RUNNING";
  if (crashed) return "CRASHED";
  if (errored) return "ERROR";

  if (launching || active.some((a) => a.status === "launching")) return "LAUNCHING";

  const launchingActivity = active.find((a) => a.status === "creating" || a.status === "preparing");
  if (launchingActivity) return "CREATING";

  if (active.some((a) => a.status === "downloading" || a.status === "verifying")) return "DOWNLOADING";
  if (active.some((a) => a.status === "installing" || a.status === "importing" || a.status === "exporting" || a.status === "repairing")) {
    return "INSTALLING";
  }

  return "READY";
}