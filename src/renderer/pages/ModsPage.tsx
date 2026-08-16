import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, SearchX, TriangleAlert } from "lucide-react";
import type {
  InstanceRecord,
  ModEnvironment,
  ModLoader,
  ModrinthCategory,
  ModSearchSort,
  ModrinthSearchHit,
} from "@shared/types/ipc";
import { useModStore } from "../stores/useModStore";
import { ModCard } from "../components/ModCard";
import { ModDetailsModal } from "../components/ModDetailsModal";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { toast } from "../stores/useToastStore";

const LOADER_TABS: { id: ModLoader | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "fabric", label: "Fabric" },
  { id: "forge", label: "Forge" },
  { id: "neoforge", label: "NeoForge" },
  { id: "quilt", label: "Quilt" },
];

const SORT_OPTIONS: { id: ModSearchSort; label: string }[] = [
  { id: "relevance", label: "Relevance" },
  { id: "downloads", label: "Downloads" },
  { id: "newest", label: "Newest" },
  { id: "updated", label: "Updated" },
];

const ENVIRONMENT_OPTIONS: { id: ModEnvironment; label: string }[] = [
  { id: "all", label: "Any environment" },
  { id: "client", label: "Client" },
  { id: "server", label: "Server" },
  { id: "both", label: "Client + server" },
];

export default function ModsPage() {
  const {
    query,
    loader,
    sort,
    gameVersion,
    category,
    environment,
    hits,
    totalHits,
    offset,
    limit,
    searching,
    searchError,
    installedByInstance,
    installingKeys,
    setQuery,
    setLoader,
    setSort,
    setGameVersion,
    setCategory,
    setEnvironment,
    search,
    nextPage,
    prevPage,
    install,
    refreshInstalled,
  } = useModStore();

  const [instances, setInstances] = useState<InstanceRecord[]>([]);
  const [installTarget, setInstallTarget] = useState<ModrinthSearchHit | null>(null);
  const [mcVersions, setMcVersions] = useState<string[]>([]);
  const [categories, setCategories] = useState<ModrinthCategory[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    window.noxara.listInstances().then(setInstances);
    // Real, current version list from Mojang's manifest — never hardcoded, so this
    // stays correct as new Minecraft versions ship.
    window.noxara.getVersionManifest().then((manifest) => {
      setMcVersions(manifest.versions.filter((v) => v.type === "release").map((v) => v.id));
    });
    // Real category list from Modrinth's tag endpoint.
    window.noxara.getModCategories().then(setCategories).catch(() => setCategories([]));
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(0), 350);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, loader, sort, gameVersion, category, environment]);

  useEffect(() => {
    for (const inst of instances) refreshInstalled(inst.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances]);

  const moddableInstances = useMemo(
    () => instances.filter((i) => i.loader !== "vanilla"),
    [instances]
  );

  function isInstalledAnywhere(projectId: string): boolean {
    return Object.values(installedByInstance).some((mods) =>
      mods.some((m) => m.sourceId === projectId)
    );
  }

  async function handleInstall(instanceId: string, mod: ModrinthSearchHit, versionId: string) {
    try {
      await install(instanceId, mod.projectId, versionId);
      toast.success("Mod installed", `${mod.title} was added to your instance`);
      setInstallTarget(null);
    } catch (e) {
      toast.error("Couldn't install mod", e instanceof Error ? e.message : undefined);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <PageHeader title="Mods" subtitle="Browse and install mods from Modrinth." />

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-noxara-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Modrinth…"
          className="yz-input w-full pl-9 pr-9"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-noxara-muted hover:text-noxara-text transition-colors"
          >
            <X size={15} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex gap-1 flex-wrap">
          {LOADER_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setLoader(t.id)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors duration-150 yz-focus-ring ${
                loader === t.id
                  ? "bg-noxara-elevated text-noxara-white border border-noxara-border-strong"
                  : "text-noxara-muted hover:text-noxara-text hover:bg-noxara-surface border border-transparent"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as ModSearchSort)}
          className="yz-select py-1.5 text-xs w-auto"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              Sort: {o.label}
            </option>
          ))}
        </select>
        <select
          value={gameVersion}
          onChange={(e) => setGameVersion(e.target.value)}
          className="yz-select py-1.5 text-xs w-auto"
        >
          <option value="all">Any Minecraft version</option>
          {mcVersions.map((v) => (
            <option key={v} value={v}>
              Minecraft {v}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="yz-select py-1.5 text-xs w-auto"
        >
          <option value="all">Any category</option>
          {categories.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={environment}
          onChange={(e) => setEnvironment(e.target.value as ModEnvironment)}
          className="yz-select py-1.5 text-xs w-auto"
        >
          {ENVIRONMENT_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {searching ? (
        <div className="space-y-2.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="yz-skeleton h-24 rounded-md" />
          ))}
        </div>
      ) : searchError ? (
        <EmptyState
          icon={TriangleAlert}
          title="Search failed"
          description={searchError}
          action={
            <button onClick={() => search()} className="yz-btn-secondary text-xs">
              Retry
            </button>
          }
        />
      ) : hits.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No mods found"
          description="Try another search or filter."
        />
      ) : (
        <>
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-xs text-noxara-muted">
              {totalHits.toLocaleString()} results
              {totalHits > 0 && ` · ${offset + 1}-${Math.min(offset + limit, totalHits)}`}
            </p>
            {totalHits > limit && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => prevPage()}
                  disabled={offset === 0}
                  className="yz-btn-ghost text-xs px-2 py-1 disabled:opacity-30"
                >
                  Prev
                </button>
                <button
                  onClick={() => nextPage()}
                  disabled={offset + limit >= totalHits}
                  className="yz-btn-ghost text-xs px-2 py-1 disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            )}
          </div>
          <div className="space-y-2.5">
            {hits.map((mod) => (
              <ModCard
                key={mod.projectId}
                mod={mod}
                installed={isInstalledAnywhere(mod.projectId)}
                installing={moddableInstances.some((i) =>
                  installingKeys.has(`${i.id}:${mod.projectId}`)
                )}
                onInstall={() => setInstallTarget(mod)}
                onOpen={() => setInstallTarget(mod)}
              />
            ))}
          </div>
          {totalHits > limit && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <button
                onClick={() => prevPage()}
                disabled={offset === 0}
                className="yz-btn-secondary text-xs px-3 py-1.5 disabled:opacity-30"
              >
                Previous
              </button>
              <button
                onClick={() => nextPage()}
                disabled={offset + limit >= totalHits}
                className="yz-btn-secondary text-xs px-3 py-1.5 disabled:opacity-30"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}

      {installTarget && (
        <ModDetailsModal
          mod={installTarget}
          moddableInstances={moddableInstances}
          installingKeys={installingKeys}
          browseLoader={loader}
          browseGameVersion={gameVersion}
          onInstall={handleInstall}
          onClose={() => setInstallTarget(null)}
        />
      )}
    </div>
  );
}
