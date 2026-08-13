import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Play,
  X,
  Copy,
  FolderOpen,
  Trash2,
  Search,
  RefreshCw,
  Loader2,
  Package,
  ShieldCheck,
  HeartPulse,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Wrench,
} from "lucide-react";
import type { InstanceHealthReport, InstanceHealthCheck, InstanceRecord, ModrinthSearchHit } from "@shared/types/ipc";
import { useLaunchStore, launchInstance } from "../stores/useLaunchStore";
import { useModStore } from "../stores/useModStore";
import { InstanceCover } from "../components/InstanceCover";
import { ModDetailsModal } from "../components/ModDetailsModal";
import { toast } from "../stores/useToastStore";

const TABS = ["Overview", "Mods", "Logs"] as const;

export default function InstanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [instance, setInstance] = useState<InstanceRecord | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const logs = useLaunchStore((s) => (id ? s.logsByInstance[id] ?? [] : []));
  const running = useLaunchStore((s) => (id ? s.runningInstanceIds.has(id) : false));
  const launching = useLaunchStore((s) => (id ? s.launchingInstanceIds.has(id) : false));
  const kill = useLaunchStore((s) => s.kill);

  const [health, setHealth] = useState<InstanceHealthReport | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [repairing, setRepairing] = useState(false);

  async function handleCheckHealth() {
    if (!id) return;
    setCheckingHealth(true);
    try {
      setHealth(await window.noxara.checkInstanceHealth(id));
    } catch (e) {
      toast.error("Health check failed", e instanceof Error ? e.message : undefined);
    } finally {
      setCheckingHealth(false);
    }
  }

  async function handleRepair() {
    if (!id) return;
    setRepairing(true);
    try {
      const report = await window.noxara.repairInstance(id);
      setHealth(report);
      toast.success("Instance repaired");
    } catch (e) {
      toast.error("Repair failed", e instanceof Error ? e.message : undefined);
    } finally {
      setRepairing(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    window.noxara.listInstances().then((list) => setInstance(list.find((i) => i.id === id) ?? null));
  }, [id]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs]);

  async function handlePlay() {
    if (!id) return;
    setError(null);
    try {
      await launchInstance(id);
      setTab("Logs");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to launch");
    }
  }

  async function handleKill() {
    if (!id) return;
    try {
      await kill(id);
      toast.success("Instance stopped");
    } catch (e) {
      toast.error("Couldn't stop instance", e instanceof Error ? e.message : undefined);
    }
  }

  async function handleDelete() {
    if (!id) return;
    await window.noxara.deleteInstance(id);
    navigate("/instances");
  }

  async function handleDuplicate() {
    if (!id || !instance) return;
    const copy = await window.noxara.duplicateInstance(id, `${instance.name} Copy`);
    navigate(`/instances/${copy.id}`);
  }

  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    if (!instance) return;
    setExporting(true);
    try {
      const destPath = await window.noxara.pickModpackSavePath(instance.name);
      if (!destPath) return;
      await window.noxara.exportModpack(instance.id, destPath);
      toast.success("Modpack exported", destPath);
    } catch (e) {
      toast.error("Couldn't export modpack", e instanceof Error ? e.message : undefined);
    } finally {
      setExporting(false);
    }
  }

  if (!instance) {
    return (
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <div className="yz-card p-5 flex items-center gap-4 mb-6">
          <div className="yz-skeleton w-24 h-24 rounded-xl shrink-0" />
          <div className="flex-1 space-y-2.5">
            <div className="yz-skeleton h-6 w-48 rounded" />
            <div className="yz-skeleton h-4 w-64 rounded" />
            <div className="yz-skeleton h-3 w-44 rounded" />
          </div>
        </div>
        <div className="flex gap-1 border-b border-noxara-border mb-4 pb-0.5">
          <div className="yz-skeleton h-8 w-20 rounded" />
          <div className="yz-skeleton h-8 w-16 rounded" />
          <div className="yz-skeleton h-8 w-16 rounded" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="yz-skeleton h-20 rounded-md" />
          <div className="yz-skeleton h-20 rounded-md" />
          <div className="yz-skeleton h-20 rounded-md" />
          <div className="yz-skeleton h-20 rounded-md" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="yz-card p-5 flex flex-col sm:flex-row sm:items-center gap-4 mb-6">
        <InstanceCover
          loader={instance.loader}
          className="w-24 h-24 shrink-0 rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl md:text-2xl font-semibold text-noxara-white truncate">
              {instance.name}
            </h1>
            {running && (
              <span className="flex items-center gap-1.5 text-[10px] font-medium bg-noxara-success/10 text-noxara-success px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-noxara-success animate-pulse" />
                RUNNING
              </span>
            )}
            {launching && (
              <span className="flex items-center gap-1.5 text-[10px] font-medium bg-noxara-elevated text-noxara-text px-2 py-0.5 rounded-full">
                <Loader2 size={10} className="animate-spin" />
                LAUNCHING
              </span>
            )}
          </div>
          <p className="text-sm text-noxara-subtle mt-0.5">
            Minecraft {instance.minecraftVersion} ·{" "}
            {loaderLabel(instance.loader, instance.loaderVersion)}
          </p>
          <p className="text-xs text-noxara-muted mt-2">
            {instance.lastPlayedAt
              ? `Last played ${new Date(instance.lastPlayedAt).toLocaleString()}`
              : "Never played"}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {running ? (
            <button onClick={handleKill} className="yz-btn-danger px-5">
              <X size={16} /> Kill Instance
            </button>
          ) : (
            <button onClick={handlePlay} disabled={launching} className="yz-btn-primary px-5">
              {launching ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Launching…
                </>
              ) : (
                <>
                  <Play size={16} /> Play
                </>
              )}
            </button>
          )}
          <button onClick={handleDuplicate} className="yz-btn-secondary" title="Duplicate" aria-label="Duplicate">
            <Copy size={16} />
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="yz-btn-secondary disabled:opacity-40"
            title="Export Modpack"
            aria-label="Export Modpack"
          >
            <Package size={16} />
          </button>
          <button
            onClick={() => id && window.noxara.openInstanceFolder(id)}
            className="yz-btn-secondary"
            title="Open Folder"
            aria-label="Open Folder"
          >
            <FolderOpen size={16} />
          </button>
          <button
            onClick={() => setConfirmDelete(true)}
            className="yz-btn-danger"
            title="Delete"
            aria-label="Delete"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 yz-card border-noxara-error/40 bg-noxara-error/5 px-4 py-3 text-sm text-noxara-error">
          {error}
        </div>
      )}

      <div className="flex gap-1 border-b border-noxara-border mb-4">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm border-b-2 transition-colors ${
              tab === t ? "border-noxara-white text-noxara-white" : "border-transparent text-noxara-muted hover:text-noxara-text"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <InfoRow label="Java" value={instance.javaPath ?? "Auto-detected"} />
            <InfoRow label="Loader" value={loaderLabel(instance.loader, instance.loaderVersion)} />
            <InfoRow label="Memory" value={`${instance.minRamMb} – ${instance.maxRamMb} MB`} />
            <InfoRow label="Created" value={new Date(instance.createdAt).toLocaleDateString()} />
            <InfoRow label="Last Played" value={instance.lastPlayedAt ? new Date(instance.lastPlayedAt).toLocaleString() : "Never"} />
          </div>
          <HealthCard
            health={health}
            checking={checkingHealth}
            repairing={repairing}
            onCheck={handleCheckHealth}
            onRepair={handleRepair}
          />
        </div>
      )}

      {tab === "Mods" && instance && <InstanceModsTab instance={instance} />}

      {tab === "Logs" && (
        <div
          ref={logRef}
          className="yz-card p-3 h-96 overflow-y-auto font-mono text-xs text-noxara-subtle whitespace-pre-wrap"
        >
          {logs.length === 0 ? (
            <p className="text-noxara-muted">No output yet. Launch the instance to see live logs here.</p>
          ) : (
            logs.map((line, idx) => <div key={idx}>{line}</div>)
          )}
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="yz-card p-6 max-w-sm">
            <h2 className="text-sm font-semibold mb-2">Delete {instance.name}?</h2>
            <p className="text-sm text-noxara-muted mb-5">
              This removes mods, configs, worlds, screenshots, and settings for this instance. This can't be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(false)} className="yz-btn-ghost">Cancel</button>
              <button onClick={handleDelete} className="yz-btn-danger">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="yz-card px-4 py-3">
      <div className="yz-label mb-1">{label}</div>
      <div className="text-sm text-noxara-text">{value}</div>
    </div>
  );
}

const HEALTH_ACCENT: Record<InstanceHealthReport["status"], string> = {
  healthy: "text-noxara-success border-noxara-success/30 bg-noxara-success/5",
  attention: "text-noxara-warning border-noxara-warning/30 bg-noxara-warning/5",
  broken: "text-noxara-error border-noxara-error/30 bg-noxara-error/5",
};

const CHECK_ICON: Record<InstanceHealthCheck["status"], typeof CheckCircle2> = {
  ok: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

const CHECK_COLOR: Record<InstanceHealthCheck["status"], string> = {
  ok: "text-noxara-success",
  warning: "text-noxara-warning",
  error: "text-noxara-error",
};

function HealthCard({
  health,
  checking,
  repairing,
  onCheck,
  onRepair,
}: {
  health: InstanceHealthReport | null;
  checking: boolean;
  repairing: boolean;
  onCheck: () => void;
  onRepair: () => void;
}) {
  if (!health) {
    return (
      <div className="yz-card p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-noxara-text">
            <ShieldCheck size={15} className="text-noxara-subtle" />
            Instance Health
          </div>
          <p className="text-xs text-noxara-muted mt-0.5">
            Checks the client files, Java runtime, installed mods, and required dependencies.
          </p>
        </div>
        <button onClick={onCheck} disabled={checking} className="yz-btn-secondary shrink-0">
          {checking ? <Loader2 size={15} className="animate-spin" /> : <HeartPulse size={15} />}
          {checking ? "Checking…" : "Check health"}
        </button>
      </div>
    );
  }

  return (
    <div className={`yz-card border p-4 ${HEALTH_ACCENT[health.status]}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold capitalize text-noxara-text">
            <ShieldCheck size={15} />
            {health.status === "healthy" ? "Healthy" : health.status === "attention" ? "Needs attention" : "Broken"}
          </div>
          <p className="text-xs text-noxara-muted mt-0.5">
            {health.checks.length} checks · {health.checks.filter((c) => c.status === "ok").length} ok
            {health.checks.some((c) => c.status === "warning")
              ? ` · ${health.checks.filter((c) => c.status === "warning").length} warnings`
              : ""}
            {health.checks.some((c) => c.status === "error")
              ? ` · ${health.checks.filter((c) => c.status === "error").length} errors`
              : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={onCheck} disabled={checking} className="yz-btn-secondary text-xs px-2.5 py-1.5">
            {checking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Recheck
          </button>
          <button onClick={onRepair} disabled={repairing} className="yz-btn-primary text-xs px-2.5 py-1.5">
            {repairing ? <Loader2 size={13} className="animate-spin" /> : <Wrench size={13} />}
            Repair
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-1">
        {health.checks.map((check) => {
          const Icon = CHECK_ICON[check.status];
          return (
            <div key={check.id} className="flex items-start gap-2 px-1 py-1">
              <Icon size={14} className={`shrink-0 mt-0.5 ${CHECK_COLOR[check.status]}`} />
              <div className="min-w-0">
                <span className="text-sm text-noxara-text">{check.label}</span>
                {check.detail && (
                  <span className="text-xs text-noxara-muted"> · {check.detail}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function loaderLabel(loader: InstanceRecord["loader"], loaderVersion: string | null): string {
  if (loader === "vanilla") return "Vanilla";
  const base =
    loader === "fabric" ? "Fabric" : loader === "forge" ? "Forge" : loader === "neoforge" ? "NeoForge" : "Quilt";
  return loaderVersion ? `${base} ${loaderVersion}` : base;
}

function InstanceModsTab({ instance }: { instance: InstanceRecord }) {
  const {
    installedByInstance,
    installingKeys,
    updatesByInstance,
    install,
    remove,
    refreshInstalled,
    checkUpdates,
  } = useModStore();

  // Deliberately NOT sharing state with the global Mods-page search (useModStore's
  // query/hits/loader) — that store's `loader` filter reflects whatever the user last
  // picked on the Mods page, which has no reason to match this instance's actual
  // loader. A Forge instance searching mods must always search Forge-compatible mods
  // for this instance's exact Minecraft version, regardless of what filter is set
  // elsewhere in the app.
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ModrinthSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [detailsMod, setDetailsMod] = useState<ModrinthSearchHit | null>(null);

  const installed = installedByInstance[instance.id] ?? [];
  const updates = updatesByInstance[instance.id] ?? [];
  const isVanilla = instance.loader === "vanilla";

  useEffect(() => {
    refreshInstalled(instance.id);
    checkUpdates(instance.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id]);

  useEffect(() => {
    if (isVanilla) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const result = await window.noxara.searchMods({
          query,
          loader: instance.loader as any,
          gameVersion: instance.minecraftVersion,
          sort: "relevance",
          limit: 20,
        });
        if (!cancelled) setHits(result.hits);
      } catch (e) {
        if (!cancelled) {
          setSearchError(e instanceof Error ? e.message : "Search failed");
          setHits([]);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, instance.loader, instance.minecraftVersion, isVanilla]);

  async function handleInstall(instanceId: string, mod: ModrinthSearchHit, versionId: string) {
    try {
      await install(instanceId, mod.projectId, versionId);
      toast.success("Mod installed", `${mod.title} added to ${instance.name}`);
      setDetailsMod(null);
    } catch (e) {
      toast.error("Couldn't install mod", e instanceof Error ? e.message : undefined);
    }
  }

  async function handleRemove(modId: string, name: string) {
    try {
      await remove(instance.id, modId);
      toast.success("Mod removed", name);
    } catch (e) {
      toast.error("Couldn't remove mod", e instanceof Error ? e.message : undefined);
    }
  }

  if (isVanilla) {
    return (
      <div className="yz-card p-10 text-center text-sm text-noxara-muted">
        Vanilla instances can't run mods. Create a Fabric or Forge instance to
        install mods.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {updates.length > 0 && (
        <div className="yz-card p-4 border-noxara-border-strong">
          <p className="text-xs yz-label mb-2">Updates Available</p>
          {updates.map((u) => (
            <div key={u.modId} className="flex items-center justify-between py-1.5 text-sm">
              <span className="text-noxara-text">
                {u.currentVersion} → {u.latestVersion.versionNumber}
              </span>
              <button
                onClick={() => install(instance.id, u.latestVersion.projectId, u.latestVersion.id)}
                className="yz-btn-secondary text-xs px-2.5 py-1"
              >
                Update
              </button>
            </div>
          ))}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-noxara-text">Installed Mods</h3>
          <button
            onClick={() => checkUpdates(instance.id)}
            className="text-noxara-muted hover:text-noxara-text transition-colors"
            aria-label="Check for updates"
          >
            <RefreshCw size={14} />
          </button>
        </div>
        {installed.length === 0 ? (
          <div className="yz-card p-6 text-center text-sm text-noxara-muted">
            This instance doesn't have any mods yet. Search below to add some.
          </div>
        ) : (
          <div className="space-y-1.5">
            {installed.map((mod) => (
              <div key={mod.id} className="yz-card px-3.5 py-2.5 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="text-sm text-noxara-text truncate">{mod.name}</div>
                  <div className="text-xs text-noxara-muted">
                    {mod.version} {!mod.fileExists && "· file missing"}
                  </div>
                </div>
                <button
                  onClick={() => handleRemove(mod.id, mod.name)}
                  className="yz-btn-ghost text-xs px-2 py-1"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-noxara-text mb-2">Add Mod</h3>
        <div className="relative mb-3">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-noxara-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Modrinth…"
            className="yz-input w-full pl-9 pr-9"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-noxara-muted hover:text-noxara-text"
              aria-label="Clear"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {searching ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="yz-skeleton h-16 rounded-md" />
            ))}
          </div>
        ) : searchError ? (
          <p className="text-sm text-noxara-error">{searchError}</p>
        ) : (
          <div className="space-y-1.5">
            {hits.map((mod) => {
              const already = installed.some((m) => m.sourceId === mod.projectId);
              const key = `${instance.id}:${mod.projectId}`;
              return (
                <div key={mod.projectId} className="yz-card px-3.5 py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded bg-noxara-elevated border border-noxara-border overflow-hidden shrink-0">
                      {mod.iconUrl && <img src={mod.iconUrl} alt="" className="w-full h-full object-cover" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm text-noxara-text truncate">{mod.title}</div>
                      <div className="text-xs text-noxara-muted truncate">{mod.description}</div>
                    </div>
                  </div>
                  {already ? (
                    <span className="text-xs text-noxara-success shrink-0">Installed</span>
                  ) : (
                    <button
                      onClick={() => setDetailsMod(mod)}
                      disabled={installingKeys.has(key)}
                      className="yz-btn-secondary text-xs px-2.5 py-1 shrink-0"
                    >
                      {installingKeys.has(key) ? "…" : "Add"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {detailsMod && (
        <ModDetailsModal
          mod={detailsMod}
          moddableInstances={[instance]}
          initialInstance={instance}
          installingKeys={installingKeys}
          onInstall={handleInstall}
          onClose={() => setDetailsMod(null)}
        />
      )}
    </div>
  );
}
