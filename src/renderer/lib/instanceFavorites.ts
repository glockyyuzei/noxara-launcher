import type { InstanceRecord } from "@shared/types/ipc";

/**
 * Toggles an instance's favorite flag via the IPC layer and returns the updated
 * record (so callers can refresh their local list without a full re-fetch).
 * Throws on failure so callers can surface it (e.g. toast).
 */
export async function toggleInstanceFavorite(instance: InstanceRecord): Promise<InstanceRecord> {
  return window.noxara.updateInstance(instance.id, { favorite: !instance.favorite });
}