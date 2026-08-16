import { useEffect, useState } from "react";
import { Download, Users, X, ChevronLeft, Check, AlertTriangle, XCircle, Loader2, Package } from "lucide-react";
import type {
  ContentCategory,
  InstanceRecord,
  ModDependenciesResult,
  ModLoader,
  ModpackImportInput,
  ModrinthSearchHit,
  ModrinthVersion,
} from "@shared/types/ipc";
import { toast } from "../stores/useToastStore";

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
 * Shows mod/content details and lets the user install it. The flow is version-first:
 * the list of available versions (each tagged with its Minecraft versions + loaders)
 * is shown up front so users can see exactly what they're downloading before choosing
 * where it goes.
 *
 * - Modpacks get two targets: install into an existing (loader-compatible) instance,
 *   OR create a brand-new dedicated instance for the pack (works even with zero
 *   instances).
 * - Mods / resource packs / shaders install into a chosen existing instance.
 *
 * Nothing here ever silently installs `versions[0]` on the user's behalf.
 */
export function ModDetailsModal({
  mod,
  moddableInstances,
  installingKeys,
  onInstall,
  onInstallNewInstance,
  onClose,
  initialInstance,
  category = "mod",
  browseLoader,
  browseGameVersion,
}: {
  mod: ModrinthSearchHit;
  moddableInstances: InstanceRecord[];
  installingKeys: Set<string>;
  onInstall: (instanceId: string, mod: ModrinthSearchHit, versionId: string) => void;
  /** For modpacks: creates a dedicated new instance and installs the pack into it. */
  onInstallNewInstance?: (versionId: string, input: ModpackImportInput) => Promise<void>;
  onClose: () => void;
  initialInstance?: InstanceRecord;
  category?: ContentCategory | "mod";
  /** The browse page's current loader filter ("all" = none). */
  browseLoader?: ModLoader | "all";
  /** The browse page's current Minecraft version filter ("all" = none). */
  browseGameVersion?: string;
}) {
  const [selectedInstance, setSelectedInstance] = useState<InstanceRecord | null>(initialInstance ?? null);
  const [versions, setVersions] = useState<ModrinthVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [imgFailed, setImgFailed] = useState(false);
  const [deps, setDeps] = useState<ModDependenciesResult | null>(null);
  const [depsLoading, setDepsLoading] = useState(false);
  const [depsError, setDepsError] = useState<string | null>(null);
  // New-instance form (modpacks)
  const [newName, setNewName] = useState("");
  const [minRam, setMinRam] = useState("2048");
  const [maxRam, setMaxRam] = useState("4096");
  const [creatingNew, setCreatingNew] = useState(false);

  useEffect(() => {
    setNewName(mod.title);
    window.noxara.getSettings().then((s) => {
      setMinRam(String(s.defaultMinRamMb));
      setMaxRam(String(s.defaultMaxRamMb));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch versions whenever the target instance or browse filters change. Before any
  // instance is chosen we use the browse page's filters (so the list is relevant); once
  // an instance is selected we narrow to that instance's loader + Minecraft version.
  useEffect(() => {
    let cancelled = false;
    setVersionsLoading(true);
    setVersionsError(null);
    setVersions([]);
    setSelectedVersionId(null);
    // Resource packs and shaders aren't loader-scoped on Modrinth — only mods and
    // modpacks are, so only those filter versions by a loader. A vanilla target
    // instance has no loader to filter by either.
    const needsLoader = category === "mod" || category === "modpack";
    const instanceLoader = selectedInstance?.loader && selectedInstance.loader !== "vanilla" ? selectedInstance.loader : undefined;
    const loaderArg = needsLoader
      ? instanceLoader ?? (browseLoader && browseLoader !== "all" ? browseLoader : undefined)
      : undefined;
    const gameVersionArg = selectedInstance?.minecraftVersion ?? (browseGameVersion && browseGameVersion !== "all" ? browseGameVersion : undefined);
    window.noxara
      .getModVersions(mod.projectId, loaderArg as any, gameVersionArg)
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
  }, [selectedInstance, mod.projectId, category, browseLoader, browseGameVersion]);

  const needsLoader = category === "mod" || category === "modpack";
  const isModpack = category === "modpack";
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

  const selectedVersion = versions.find((v) => v.id === selectedVersionId) ?? null;
  // For modpacks the existing-instance picker only shows instances whose loader is
  // supported by the selected version.
  const compatibleInstances =
    isModpack && selectedVersion
      ? moddableInstances.filter((i) => selectedVersion.loaders.includes(i.loader))
      : moddableInstances;

  // Dependency resolution for the currently-selected version + instance. Only mods
  // (not resource packs/shaders) declare dependencies on Modrinth.
  useEffect(() => {
    if (!selectedInstance || !selectedVersionId || category !== "mod") {
      setDeps(null);
      setDepsError(null);
      return;
    }
    let cancelled = false;
    setDepsLoading(true);
    setDepsError(null);
    setDeps(null);
    window.noxara
      .getModDependencies(selectedInstance.id, selectedVersionId)
      .then((result) => {
        if (cancelled) return;
        setDeps(result);
      })
      .catch((e) => {
        if (cancelled) return;
        setDepsError(e instanceof Error ? e.message : "Couldn't check dependencies");
      })
      .finally(() => {
        if (!cancelled) setDepsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedInstance, selectedVersionId, category]);

  // An installed incompatible dependency is a hard block — the install would break
  // whichever mod already owns that project.
  const conflictsInstalled =
    deps?.incompatible.some((c) => c.installed) ?? false;
  const missingCount = deps?.missing.length ?? 0;

  async function handleCreateNewInstance() {
    if (!selectedVersionId || !onInstallNewInstance) return;
    setCreatingNew(true);
    try {
      await onInstallNewInstance(selectedVersionId, {
        name: newName.trim() || mod.title,
        minRamMb: Number(minRam) || 2048,
        maxRamMb: Number(maxRam) || 4096,
      });
      onClose();
    } catch (e) {
      toast.error("Couldn't install modpack", e instanceof Error ? e.message : undefined);
    } finally {
      setCreatingNew(false);
    }
  }

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
          <h3 className="text-xs yz-label mb-2">Choose a Version</h3>
          {versionsLoading ? (
            <div className="text-sm text-noxara-muted px-3 py-4 text-center border border-noxara-border rounded">
              Loading versions…
            </div>
          ) : versionsError ? (
            <div className="text-sm text-noxara-error px-3 py-3 border border-noxara-border rounded">{versionsError}</div>
          ) : versions.length === 0 ? (
            <div className="text-sm text-noxara-muted px-3 py-4 text-center border border-noxara-border rounded">
              No version of {mod.title} is available
              {selectedInstance
                ? ` for ${selectedInstance.minecraftVersion} on ${selectedInstance.loader}.`
                : " for the current filters."}
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
                  <div className="flex flex-wrap gap-1 mt-1">
                    {v.gameVersions.slice(0, 3).map((gv) => (
                      <span key={gv} className="px-1.5 py-0.5 rounded text-[10px] bg-noxara-surface border border-noxara-border text-noxara-subtle">
                        MC {gv}
                      </span>
                    ))}
                    {v.loaders.map((l) => (
                      <span key={l} className="px-1.5 py-0.5 rounded text-[10px] bg-noxara-elevated border border-noxara-border capitalize text-noxara-subtle">
                        {l}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}

          {isModpack ? (
            <>
              {!onInstallNewInstance ? (
                <p className="text-sm text-noxara-muted">
                  {compatibleInstances.length === 0
                    ? "You don't have any compatible instances yet — create a compatible one to install this modpack."
                    : "Pick an instance below to install this modpack into."}
                </p>
              ) : (
                <>
                  <h3 className="text-xs yz-label mb-2">Install to</h3>
                  <div className="space-y-2 mb-4">
                    <div className="rounded border border-noxara-border p-3">
                      <div className="flex items-center gap-2 text-sm text-noxara-text mb-2">
                        <Package size={14} className="text-noxara-subtle" />
                        Create a new instance for this modpack
                        {selectedVersion && (
                          <span className="text-xs text-noxara-muted">
                            (MC {selectedVersion.gameVersions[0] ?? "?"} · {selectedVersion.loaders[0] ?? "?"})
                          </span>
                        )}
                      </div>
                      <div className="space-y-2">
                        <div>
                          <label className="yz-label block mb-1">Instance name</label>
                          <input
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="My modpack"
                            className="yz-input w-full"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="yz-label block mb-1">Min RAM (MB)</label>
                            <input
                              value={minRam}
                              onChange={(e) => setMinRam(e.target.value.replace(/[^0-9]/g, ""))}
                              className="yz-input w-full tabular-nums"
                            />
                          </div>
                          <div>
                            <label className="yz-label block mb-1">Max RAM (MB)</label>
                            <input
                              value={maxRam}
                              onChange={(e) => setMaxRam(e.target.value.replace(/[^0-9]/g, ""))}
                              className="yz-input w-full tabular-nums"
                            />
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded border border-noxara-border p-3">
                      <div className="text-sm text-noxara-text mb-2">Install to an existing instance</div>
                      {compatibleInstances.length === 0 ? (
                        <p className="text-xs text-noxara-muted">
                          No existing instances support this modpack's loader{selectedVersion ? ` (${selectedVersion.loaders.join(", ") || "none"})` : ""}. Create a new instance above.
                        </p>
                      ) : (
                        <div className="space-y-1.5 max-h-40 overflow-y-auto">
                          {compatibleInstances.map((inst) => (
                            <button
                              key={inst.id}
                              onClick={() => setSelectedInstance(inst)}
                              className={`w-full text-left rounded px-3 py-2 border transition-colors duration-150 yz-focus-ring ${
                                selectedInstance?.id === inst.id
                                  ? "border-noxara-white bg-noxara-elevated"
                                  : "border-noxara-border hover:border-noxara-border-strong hover:bg-noxara-surface"
                              }`}
                            >
                              <div className="text-sm text-noxara-text">{inst.name}</div>
                              <div className="text-xs text-noxara-muted">
                                {inst.minecraftVersion} · {inst.loader}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {selectedInstance && (
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <button
                        onClick={() => setSelectedInstance(null)}
                        className="flex items-center gap-1 text-xs text-noxara-muted hover:text-noxara-text transition-colors"
                      >
                        <ChevronLeft size={13} /> Choose a different instance
                      </button>
                      <button
                        onClick={() => selectedVersionId && onInstall(selectedInstance.id, mod, selectedVersionId)}
                        disabled={!selectedVersionId || installing}
                        className="yz-btn-primary text-sm py-2 disabled:opacity-50"
                      >
                        {installing ? "Installing…" : `Install ${noun} into ${selectedInstance.name}`}
                      </button>
                    </div>
                  )}
                  {!selectedInstance && (
                    <button
                      onClick={handleCreateNewInstance}
                      disabled={!selectedVersionId || creatingNew}
                      className="yz-btn-primary w-full text-sm py-2 disabled:opacity-50"
                    >
                      {creatingNew ? (
                        <>
                          <Loader2 size={15} className="animate-spin" /> Creating instance &amp; installing…
                        </>
                      ) : (
                        "Create instance & install"
                      )}
                    </button>
                  )}
                </>
              )}
            </>
          ) : (
            <>
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
                  {category === "mod" && selectedVersionId && (
                    <DependencySection
                      loading={depsLoading}
                      error={depsError}
                      deps={deps}
                    />
                  )}
                  <button
                    onClick={() => selectedVersionId && onInstall(selectedInstance.id, mod, selectedVersionId)}
                    disabled={!selectedVersionId || installing || conflictsInstalled}
                    className="yz-btn-primary w-full text-sm py-2 disabled:opacity-50"
                    title={conflictsInstalled ? "Remove the conflicting mod first" : undefined}
                  >
                    {installing
                      ? "Installing…"
                      : conflictsInstalled
                        ? "Conflicting mod installed"
                        : missingCount > 0
                          ? `Install ${noun} + ${missingCount} dependenc${missingCount === 1 ? "y" : "ies"}`
                          : `Install ${noun}`}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Renders the dependency status of the selected version against the target instance:
 * installed requirements, missing requirements (auto-installed on install), and real
 * conflicts that block the install. Loading/error states are non-blocking. */
function DependencySection({
  loading,
  error,
  deps,
}: {
  loading: boolean;
  error: string | null;
  deps: ModDependenciesResult | null;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-noxara-muted px-3 py-2 mb-3 rounded border border-noxara-border">
        <Loader2 size={13} className="animate-spin" /> Checking dependencies…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-center gap-2 text-xs text-noxara-warning px-3 py-2 mb-3 rounded border border-noxara-warning/30 bg-noxara-warning/5">
        <AlertTriangle size={13} /> Couldn't check dependencies — {error}
      </div>
    );
  }
  if (!deps) return null;

  const installedConflicts = deps.incompatible.filter((c) => c.installed);
  const showSection = deps.present.length > 0 || deps.missing.length > 0 || installedConflicts.length > 0;

  if (!showSection) return null;

  return (
    <div className="mb-3 rounded border border-noxara-border overflow-hidden">
      {deps.missing.length > 0 && (
        <div className="px-3 py-2 bg-noxara-warning/5 border-b border-noxara-border">
          <div className="flex items-center gap-1.5 text-xs text-noxara-warning mb-1">
            <AlertTriangle size={13} /> This mod requires:
          </div>
          <div className="flex flex-wrap gap-1.5">
            {deps.missing.map((d) => (
              <span
                key={d.projectId}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-noxara-surface border border-noxara-border text-noxara-text"
              >
                {d.name ?? d.projectId}
                <span className="text-[10px] text-noxara-muted">· auto-install</span>
              </span>
            ))}
          </div>
        </div>
      )}
      {deps.present.length > 0 && (
        <div className="px-3 py-2 border-b border-noxara-border">
          <div className="space-y-1">
            {deps.present.map(({ dependency }) => (
              <div key={dependency.projectId} className="flex items-center gap-1.5 text-xs text-noxara-success">
                <Check size={13} /> {dependency.name ?? dependency.projectId}
                <span className="text-[10px] text-noxara-muted">· installed</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {installedConflicts.length > 0 && (
        <div className="px-3 py-2 bg-noxara-error/5">
          <div className="flex items-center gap-1.5 text-xs text-noxara-error mb-1">
            <XCircle size={13} /> Conflicts with an installed mod:
          </div>
          <div className="flex flex-wrap gap-1.5">
            {installedConflicts.map(({ dependency }) => (
              <span
                key={dependency.projectId}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-noxara-error/10 border border-noxara-error/30 text-noxara-error"
              >
                {dependency.name ?? dependency.projectId}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-noxara-muted mt-1">
            Remove the conflicting mod from the instance before installing this one.
          </p>
        </div>
      )}
    </div>
  );
}