import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { InstanceRecord, ModLoader, ModSearchSort, ModrinthSearchHit } from "@shared/types/ipc";
import { useModStore } from "../stores/useModStore";
import { ModCard } from "../components/ModCard";
import { ModDetailsModal } from "../components/ModDetailsModal";
import { toast } from "../stores/useToastStore";

const LOADER_TABS: { id: ModLoader | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "fabric", label: "Fabric" },
  { id: "forge", label: "Forge" },
];

const SORT_OPTIONS: { id: ModSearchSort; label: string }[] = [
  { id: "relevance", label: "Relevance" },
  { id: "downloads", label: "Downloads" },
  { id: "newest", label: "Newest" },
  { id: "updated", label: "Updated" },
];

export default function ModsPage() {
  const {
    query,
    loader,
    sort,
    hits,
    totalHits,
    searching,
    searchError,
    installedByInstance,
    installingKeys,
    setQuery,
    setLoader,
    setSort,
    search,
    install,
    refreshInstalled,
  } = useModStore();

  const [instances, setInstances] = useState<InstanceRecord[]>([]);
  const [installTarget, setInstallTarget] = useState<ModrinthSearchHit | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    window.noxara.listInstances().then(setInstances);
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(), 350);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, loader, sort]);

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

  async function handleInstall(instanceId: string, mod: ModrinthSearchHit) {
    try {
      const versions = await window.noxara.getModVersions(
        mod.projectId,
        instances.find((i) => i.id === instanceId)?.loader as ModLoader,
        instances.find((i) => i.id === instanceId)?.minecraftVersion
      );
      const best = versions[0];
      if (!best) {
        toast.error("No compatible version found", `${mod.title} has no version for this instance.`);
        return;
      }
      await install(instanceId, mod.projectId, best.id);
      toast.success("Mod installed", `${mod.title} was added to your instance`);
      setInstallTarget(null);
    } catch (e) {
      toast.error("Couldn't install mod", e instanceof Error ? e.message : undefined);
    }
  }

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold text-noxara-white">Mods</h1>
        <p className="text-sm text-noxara-muted mt-1">Browse and install mods from Modrinth.</p>
      </div>

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
          className="yz-input py-1.5 text-xs w-auto"
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.id} value={o.id}>
              Sort: {o.label}
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
        <div className="yz-card p-8 text-center">
          <p className="text-sm text-noxara-error mb-3">{searchError}</p>
          <button onClick={() => search()} className="yz-btn-secondary text-xs">
            Retry
          </button>
        </div>
      ) : hits.length === 0 ? (
        <div className="yz-card p-10 text-center text-sm text-noxara-muted">
          No mods found. Try another search or filter.
        </div>
      ) : (
        <>
          <p className="text-xs text-noxara-muted mb-2.5">{totalHits.toLocaleString()} results</p>
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
        </>
      )}

      {installTarget && (
        <ModDetailsModal
          mod={installTarget}
          moddableInstances={moddableInstances}
          installingKeys={installingKeys}
          onInstall={handleInstall}
          onClose={() => setInstallTarget(null)}
        />
      )}
    </div>
  );
}
