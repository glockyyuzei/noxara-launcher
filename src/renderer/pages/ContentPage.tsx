import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X, SearchX, TriangleAlert, Trash2, ToggleLeft, ToggleRight, FolderOpen } from "lucide-react";
import type {
  ContentCategory,
  InstanceRecord,
  ModLoader,
  ModSearchSort,
  ModrinthSearchHit,
} from "@shared/types/ipc";
import { useContentStore, selectInstalledContent } from "../stores/useContentStore";
import { ModCard } from "../components/ModCard";
import { ModDetailsModal } from "../components/ModDetailsModal";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
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

export default function ContentPage({
  category,
  title,
  subtitle,
  needsLoader = false,
  emptyTitle,
  emptyDescription,
  singleName,
}: {
  category: ContentCategory;
  title: string;
  subtitle: string;
  /** True for loader-dependent content (modpacks): loader filter + non-vanilla instances. */
  needsLoader?: boolean;
  emptyTitle: string;
  emptyDescription: string;
  singleName: string;
}) {
  const {
    query,
    loader,
    sort,
    gameVersion,
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
    resetBrowse,
    search,
    nextPage,
    prevPage,
    install,
    remove,
    setEnabled,
    refreshInstalled,
  } = useContentStore();

  const [instances, setInstances] = useState<InstanceRecord[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | "all">("all");
  const [installTarget, setInstallTarget] = useState<ModrinthSearchHit | null>(null);
  const [mcVersions, setMcVersions] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    // The browse state is shared across every ContentPage-backed route, so always
    // start from a clean slate on mount — never bleed another category's query or
    // filter into this one.
    resetBrowse();
    window.noxara.listInstances().then((list) => {
      setInstances(list);
      if (list.length > 0) setSelectedInstanceId((prev) => (prev === "all" ? list[0].id : prev));
    });
    window.noxara.getVersionManifest().then((manifest) => {
      setMcVersions(manifest.versions.filter((v) => v.type === "release").map((v) => v.id));
    });
    search(category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(category, 0), 350);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, loader, sort, gameVersion, category]);

  const selectedInstance = useMemo(
    () => instances.find((i) => i.id === selectedInstanceId) ?? null,
    [instances, selectedInstanceId]
  );

  useEffect(() => {
    if (selectedInstance) refreshInstalled(selectedInstance.id, category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInstance?.id, category]);

  const installed = selectedInstance ? selectInstalledContent(installedByInstance, selectedInstance.id, category) : [];
  const installableInstances = useMemo(
    () => (needsLoader ? instances.filter((i) => i.loader !== "vanilla") : instances),
    [instances, needsLoader]
  );

  async function handleInstall(instanceId: string, hit: ModrinthSearchHit, versionId: string) {
    try {
      await install(instanceId, hit.projectId, versionId, category);
      toast.success(`${singleName} installed`, `${hit.title} was added to your instance`);
      setInstallTarget(null);
    } catch (e) {
      toast.error(`Couldn't install ${singleName.toLowerCase()}`, e instanceof Error ? e.message : undefined);
    }
  }

  async function handleRemove(itemId: string, name: string) {
    if (!selectedInstance) return;
    try {
      await remove(selectedInstance.id, itemId, category);
      toast.success(`${singleName} removed`, name);
    } catch (e) {
      toast.error(`Couldn't remove ${singleName.toLowerCase()}`, e instanceof Error ? e.message : undefined);
    }
  }

  async function handleToggle(itemId: string, enabled: boolean, name: string) {
    if (!selectedInstance) return;
    try {
      await setEnabled(selectedInstance.id, itemId, category, !enabled);
      toast.success(enabled ? `${singleName} disabled` : `${singleName} enabled`, name);
    } catch (e) {
      toast.error("Couldn't change state", e instanceof Error ? e.message : undefined);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <PageHeader title={title} subtitle={subtitle} />

      <div className="flex flex-wrap items-center gap-2 mb-5">
        <label className="yz-label">Installing to</label>
        <select
          value={selectedInstanceId}
          onChange={(e) => setSelectedInstanceId(e.target.value)}
          className="yz-select py-1.5 text-xs w-auto"
        >
          <option value="all">All instances</option>
          {instances.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.minecraftVersion} · {i.loader === "vanilla" ? "Vanilla" : i.loader})
            </option>
          ))}
        </select>
      </div>

      {selectedInstance && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-sm font-semibold text-noxara-text">
              Installed in {selectedInstance.name}
              <span className="text-xs font-normal text-noxara-muted ml-2">({installed.length})</span>
            </h3>
            <button
              onClick={() => selectedInstance && window.noxara.openInstanceFolder(selectedInstance.id)}
              className="text-noxara-muted hover:text-noxara-text transition-colors"
              aria-label="Open instance folder"
            >
              <FolderOpen size={14} />
            </button>
          </div>

          {installed.length === 0 ? (
            <div className="yz-card p-6 text-center text-sm text-noxara-muted">
              No {singleName.toLowerCase()}s installed in this instance yet. Browse below to add some.
            </div>
          ) : (
            <div className="space-y-1.5">
              {installed.map((item) => (
                <div key={item.id} className="yz-card px-3.5 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-noxara-text truncate">{item.name}</div>
                    <div className="text-xs text-noxara-muted">
                      {item.version}
                      {!item.fileExists && <span className="text-noxara-warning"> · file missing</span>}
                      {category === "modpack" && item.enabled && <span> · pack mods active</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {category !== "modpack" && (
                      <button
                        onClick={() => handleToggle(item.id, item.enabled, item.name)}
                        title={item.enabled ? "Disable" : "Enable"}
                        className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
                          item.enabled
                            ? "text-noxara-success hover:bg-noxara-success/10"
                            : "text-noxara-muted hover:bg-noxara-surface"
                        }`}
                      >
                        {item.enabled ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                        {item.enabled ? "Enabled" : "Disabled"}
                      </button>
                    )}
                    <button
                      onClick={() => handleRemove(item.id, item.name)}
                      className="text-noxara-muted hover:text-noxara-error p-1.5 transition-colors"
                      aria-label={`Remove ${item.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-noxara-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${title.toLowerCase()} on Modrinth…`}
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
          {needsLoader &&
            LOADER_TABS.map((t) => (
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
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
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
            <button onClick={() => search(category)} className="yz-btn-secondary text-xs">
              Retry
            </button>
          }
        />
      ) : hits.length === 0 ? (
        <EmptyState icon={SearchX} title={emptyTitle} description={emptyDescription} />
      ) : (
        <>
          <div className="flex items-center justify-between mb-2.5">
            <p className="text-xs text-noxara-muted">
              {totalHits.toLocaleString()} results
              {totalHits > 0 && ` · ${offset + 1}-${Math.min(offset + limit, totalHits)}`}
            </p>
          </div>
          <div className="space-y-2.5">
            {hits.map((hit) => {
              const installedHere = selectedInstance
                ? installed.some((i) => i.sourceId === hit.projectId)
                : false;
              const installingHere = installableInstances.some((i) =>
                installingKeys.has(`${category}:${i.id}:${hit.projectId}`)
              );
              return (
                <ModCard
                  key={hit.projectId}
                  mod={hit}
                  installed={installedHere}
                  installing={installingHere}
                  onInstall={() => setInstallTarget(hit)}
                  onOpen={() => setInstallTarget(hit)}
                />
              );
            })}
          </div>
          {totalHits > limit && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <button
                onClick={() => prevPage(category)}
                disabled={offset === 0}
                className="yz-btn-secondary text-xs px-3 py-1.5 disabled:opacity-30"
              >
                Previous
              </button>
              <button
                onClick={() => nextPage(category)}
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
          moddableInstances={installableInstances}
          installingKeys={installingKeys}
          initialInstance={selectedInstance ?? undefined}
          category={category}
          onInstall={handleInstall}
          onClose={() => setInstallTarget(null)}
        />
      )}
    </div>
  );
}
