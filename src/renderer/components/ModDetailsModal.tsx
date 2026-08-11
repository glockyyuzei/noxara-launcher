import { Download, Users, X } from "lucide-react";
import type { InstanceRecord, ModrinthSearchHit } from "@shared/types/ipc";

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * Shows mod details and lets the user install directly into a chosen instance —
 * this is the in-app replacement for what used to be `window.open(modrinth.com/...)`.
 * Reuses the same instance list / install call the mod card's Install button uses,
 * so there's exactly one install code path, not two.
 */
export function ModDetailsModal({
  mod,
  moddableInstances,
  installingKeys,
  onInstall,
  onClose,
}: {
  mod: ModrinthSearchHit;
  moddableInstances: InstanceRecord[];
  installingKeys: Set<string>;
  onInstall: (instanceId: string, mod: ModrinthSearchHit) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8 animate-fade-in">
      <div className="yz-card w-full max-w-lg p-6 animate-modal-in max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div className="flex gap-3.5">
            <div className="shrink-0 w-16 h-16 rounded-md bg-noxara-elevated border border-noxara-border overflow-hidden">
              {mod.iconUrl ? (
                <img src={mod.iconUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-noxara-muted text-lg font-semibold">
                  {mod.title.slice(0, 1).toUpperCase()}
                </div>
              )}
            </div>
            <div>
              <h2 className="text-base font-semibold text-noxara-white">{mod.title}</h2>
              <p className="text-xs text-noxara-muted">by {mod.author}</p>
              <div className="flex items-center gap-3 mt-1.5 text-xs text-noxara-muted">
                <span className="flex items-center gap-1">
                  <Download size={12} /> {formatCount(mod.downloads)}
                </span>
                <span className="flex items-center gap-1">
                  <Users size={12} /> {formatCount(mod.follows)}
                </span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="text-noxara-muted hover:text-noxara-text transition-colors shrink-0">
            <X size={18} />
          </button>
        </div>

        <p className="text-sm text-noxara-subtle mb-4">{mod.description}</p>

        <div className="flex flex-wrap gap-1.5 mb-5">
          {mod.loaders.map((l) => (
            <span key={l} className="px-2 py-0.5 rounded text-xs bg-noxara-elevated border border-noxara-border capitalize">
              {l}
            </span>
          ))}
          {mod.categories.slice(0, 4).map((c) => (
            <span key={c} className="px-2 py-0.5 rounded text-xs bg-noxara-surface border border-noxara-border text-noxara-muted capitalize">
              {c}
            </span>
          ))}
        </div>

        <div className="border-t border-noxara-border pt-4">
          <h3 className="text-xs yz-label mb-2">Install to Instance</h3>
          {moddableInstances.length === 0 ? (
            <p className="text-sm text-noxara-muted">
              You don't have any Fabric/Forge instances yet — vanilla instances can't run mods.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-52 overflow-y-auto">
              {moddableInstances.map((inst) => (
                <button
                  key={inst.id}
                  onClick={() => onInstall(inst.id, mod)}
                  disabled={installingKeys.has(`${inst.id}:${mod.projectId}`)}
                  className="w-full text-left rounded px-3 py-2 border border-noxara-border hover:border-noxara-border-strong hover:bg-noxara-surface transition-colors duration-150 yz-focus-ring disabled:opacity-50"
                >
                  <div className="text-sm text-noxara-text">{inst.name}</div>
                  <div className="text-xs text-noxara-muted">
                    {inst.minecraftVersion} · {inst.loader}
                    {installingKeys.has(`${inst.id}:${mod.projectId}`) && " · Installing…"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
