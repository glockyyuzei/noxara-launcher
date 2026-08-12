import { useEffect, useState } from "react";
import { Download, Users, X, ChevronLeft } from "lucide-react";
import type {
  ContentCategory,
  InstanceRecord,
  ModrinthSearchHit,
  ModrinthVersion,
} from "@shared/types/ipc";

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

const CATEGORY_LABEL: Record<ContentCategory | "mod", string> = {
  mod: "mod",
  resourcepack: "resource pack",
  shader: "shader",
  modpack: "modpack",
};

/**
 * Shows mod/content details and lets the user install directly into a chosen instance —
 * this is the in-app replacement for what used to be `window.open(modrinth.com/...)`.
 *
 * Installation is a two-step, fully user-driven flow: pick the target instance, then
 * pick the exact version to install from the list of versions actually compatible
 * with that instance's Minecraft version + loader. Nothing here ever silently installs
 * `versions[0]` on the user's behalf.
 */
/** Lets ModDetailsModal skip the "pick an instance" step when it's opened from a page
 * that already has one specific instance in context. */
export function ModDetailsModal({
  mod,
  moddableInstances,
  installingKeys,
  onInstall,
  onClose,
  initialInstance,
  category = "mod",
}: {
  mod: ModrinthSearchHit;
  moddableInstances: InstanceRecord[];
  installingKeys: Set<string>;
  onInstall: (instanceId: string, mod: ModrinthSearchHit, versionId: string) => void;
  onClose: () => void;
  initialInstance?: InstanceRecord;
  category?: ContentCategory | "mod";
}) {
  const [selectedInstance, setSelectedInstance] = useState<InstanceRecord | null>(initialInstance ?? null);
  const [versions, setVersions] = useState<ModrinthVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    if (!selectedInstance) return;
    let cancelled = false;
    setVersionsLoading(true);
    setVersionsError(null);
    setVersions([]);
    setSelectedVersionId(null);
    // Resource packs and shaders aren't loader-scoped on Modrinth — only mods and
    // modpacks are, so only those filter versions by the instance's loader. Filtering
    // a resource pack by "fabric" returns no versions, since those projects tag none.
    const needsLoader = category === "mod" || category === "modpack";
    window.noxara
      .getModVersions(
        mod.projectId,
        needsLoader ? (selectedInstance.loader as any) : undefined,
        selectedInstance.minecraftVersion
      )
      .then((list) => {
        if (cancelled) return;
        setVersions(list);
        // Pre-select the newest compatible version as a convenience default, but the
        // user can change it — this is not what gets installed unless they confirm it.
        if (list.length > 0) setSelectedVersionId(list[0].id);
      })
      .catch((e) => {
        if (cancelled) return;
        setVersionsError(e instanceof Error ? e.message : "Failed to load versions");
      })
      .finally(() => {
        if (!cancelled) setVersionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedInstance, mod.projectId, category]);

  const needsLoader = category === "mod" || category === "modpack";
  // Mod store keys `installingKeys` as `${instanceId}:${projectId}`; the content store
  // keys them as `${category}:${instanceId}:${projectId}`. Build whichever one belongs
  // to this category so the in-flight installing state lights up correctly.
  const installKey = selectedInstance
    ? category === "mod"
      ? `${selectedInstance.id}:${mod.projectId}`
      : `${category}:${selectedInstance.id}:${mod.projectId}`
    : null;
  const installing = installKey ? installingKeys.has(installKey) : false;
  const noun = CATEGORY_LABEL[category as ContentCategory];

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8 animate-fade-in">
      <div className="yz-card w-full max-w-lg p-6 animate-modal-in max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div className="flex gap-3.5">
            <div className="shrink-0 w-16 h-16 rounded-md bg-noxara-elevated border border-noxara-border overflow-hidden">
              {mod.iconUrl && !imgFailed ? (
                <img src={mod.iconUrl} alt="" className="w-full h-full object-cover" onError={() => setImgFailed(true)} />
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
          {needsLoader &&
            mod.loaders.map((l) => (
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
          {!selectedInstance ? (
            <>
              <h3 className="text-xs yz-label mb-2">Install to Instance</h3>
              {moddableInstances.length === 0 ? (
                <p className="text-sm text-noxara-muted">
                  {needsLoader
                    ? "You don't have any Fabric/Forge instances yet — vanilla instances can't run these."
                    : "You don't have any instances yet — create one to install this."}
                </p>
              ) : (
                <div className="space-y-1.5 max-h-52 overflow-y-auto">
                  {moddableInstances.map((inst) => (
                    <button
                      key={inst.id}
                      onClick={() => setSelectedInstance(inst)}
                      className="w-full text-left rounded px-3 py-2 border border-noxara-border hover:border-noxara-border-strong hover:bg-noxara-surface transition-colors duration-150 yz-focus-ring"
                    >
                      <div className="text-sm text-noxara-text">{inst.name}</div>
                      <div className="text-xs text-noxara-muted">
                        {inst.minecraftVersion} · {inst.loader}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <>
              <button
                onClick={() => setSelectedInstance(null)}
                className="flex items-center gap-1 text-xs text-noxara-muted hover:text-noxara-text mb-3 transition-colors"
              >
                <ChevronLeft size={13} /> Choose a different instance
              </button>
              <div className="text-xs text-noxara-muted mb-2">
                Installing to <span className="text-noxara-text">{selectedInstance.name}</span> ({selectedInstance.minecraftVersion} ·{" "}
                {selectedInstance.loader})
              </div>
              <h3 className="text-xs yz-label mb-2">Choose a Version</h3>
              {versionsLoading ? (
                <div className="text-sm text-noxara-muted px-3 py-4 text-center border border-noxara-border rounded">
                  Loading compatible versions…
                </div>
              ) : versionsError ? (
                <div className="text-sm text-noxara-error px-3 py-3 border border-noxara-border rounded">{versionsError}</div>
              ) : versions.length === 0 ? (
                <div className="text-sm text-noxara-muted px-3 py-4 text-center border border-noxara-border rounded">
                  No version of {mod.title} supports {selectedInstance.minecraftVersion} on {selectedInstance.loader}.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-44 overflow-y-auto mb-4">
                  {versions.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => setSelectedVersionId(v.id)}
                      className={`w-full text-left rounded px-3 py-2 border transition-colors duration-150 yz-focus-ring ${
                        selectedVersionId === v.id
                          ? "border-noxara-white bg-noxara-elevated"
                          : "border-noxara-border hover:border-noxara-border-strong hover:bg-noxara-surface"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-noxara-text">{v.versionNumber}</span>
                        <span className="text-[10px] uppercase tracking-wide text-noxara-muted">{v.versionType}</span>
                      </div>
                      <div className="text-xs text-noxara-muted mt-0.5">{formatDate(v.datePublished)}</div>
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => selectedVersionId && onInstall(selectedInstance.id, mod, selectedVersionId)}
                disabled={!selectedVersionId || installing}
                className="yz-btn-primary w-full text-sm py-2 disabled:opacity-50"
              >
                {installing ? "Installing…" : `Install ${noun}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
