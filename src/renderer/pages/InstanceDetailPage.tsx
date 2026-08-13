import { useEffect, useMemo, useRef, useState } from "react";
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
  Terminal,
  Archive,
  Plus,
  Download,
} from "lucide-react";
import type { BackupRecord, InstanceHealthReport, InstanceHealthCheck, InstanceRecord, JavaInstallation, ModrinthSearchHit } from "@shared/types/ipc";
import { useLaunchStore, launchInstance } from "../stores/useLaunchStore";
import { useInstanceState } from "../stores/useInstanceState";
import type { ConsoleLine } from "../stores/useLaunchStore";
import { useModStore } from "../stores/useModStore";
import { InstanceCover } from "../components/InstanceCover";
import { ModDetailsModal } from "../components/ModDetailsModal";
import { CrashBanner } from "../components/CrashBanner";
import { InstanceStateBadge } from "../components/InstanceStateBadge";
import { friendlyErrorMessage } from "../lib/coreErrors";
import { formatBytes } from "../utils/format";
import { toast } from "../stores/useToastStore";

const TABS = ["Overview", "Mods", "Backups", "Console"] as const;

export default function InstanceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [instance, setInstance] = useState<InstanceRecord | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [followOutput, setFollowOutput] = useState(true);
  const [consoleQuery, setConsoleQuery] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  const logs = useLaunchStore((s) => (id ? s.logsByInstance[id] ?? [] : []));
  const state = id ? useInstanceState(id) : "READY";
  const running = state === "RUNNING" || state === "STOPPING";
  const launching = state === "LAUNCHING" || state === "DOWNLOADING" || state === "INSTALLING";
  const crashed = state === "CRASHED";
  const crashInfo = useLaunchStore((s) => (id ? s.crashInfoByInstance[id] : undefined));
  const clearCrashed = useLaunchStore((s) => s.clearCrashed);
  const kill = useLaunchStore((s) => s.kill);
  const clearLog = useLaunchStore((s) => s.clearLog);

  // Console search (case-insensitive, on the plain text) — derived, never mutating.
  const filteredLogs = useMemo(() => {
    const q = consoleQuery.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((l) => l.line.toLowerCase().includes(q));
  }, [logs, consoleQuery]);

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
    // Only auto-scroll when the user has "Follow output" enabled (and isn't searching)
    // — disabling it lets them scroll back through history without the stream yanking
    // the view down.
    if (followOutput && !consoleQuery) logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logs, followOutput, consoleQuery]);

  async function handlePlay() {
    if (!id) return;
    setError(null);
    try {
      await launchInstance(id);
      setTab("Console");
    } catch (e) {
      setError(friendlyErrorMessage(e));
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
            {id && <InstanceStateBadge instanceId={id} />}
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

      {crashed && crashInfo && id && (
        <CrashBanner
          info={crashInfo}
          logs={logs}
          onViewLog={() => setTab("Console")}
          onRestart={handlePlay}
          onRepair={handleRepair}
          onDismiss={() => clearCrashed(id)}
        />
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
            <JavaSelector
              current={instance.javaPath}
              onChanged={async (javaPath) => {
                try {
                  const updated = await window.noxara.updateInstance(instance.id, { javaPath });
                  setInstance(updated);
                  toast.success(javaPath ? "Java runtime pinned" : "Java set to auto-detect");
                } catch (e) {
                  toast.error("Couldn't change Java", e instanceof Error ? e.message : undefined);
                }
              }}
            />
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

      {tab === "Backups" && instance && <BackupsTab instanceId={instance.id} />}

      {tab === "Console" && (
        <div className="yz-card overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-noxara-border">
            <div className="flex items-center gap-2 text-xs min-w-0">
              <Terminal size={13} className="text-noxara-subtle shrink-0" />
              <span className="font-medium text-noxara-text">Console</span>
              {running ? (
                <span className="flex items-center gap-1 text-noxara-success">
                  <span className="w-1.5 h-1.5 rounded-full bg-noxara-success animate-pulse" /> live
                </span>
              ) : launching ? (
                <span className="text-noxara-muted">starting…</span>
              ) : null}
              <span className="text-noxara-muted truncate hidden sm:inline">
                {filteredLogs.length} / {logs.length} line{logs.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="relative">
                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-noxara-muted" />
                <input
                  value={consoleQuery}
                  onChange={(e) => setConsoleQuery(e.target.value)}
                  placeholder="Search console…"
                  className="bg-noxara-elevated border border-noxara-border rounded text-xs pl-7 pr-2 py-1 w-40 focus:border-noxara-border-strong outline-none text-noxara-text placeholder:text-noxara-muted"
                />
                {consoleQuery && (
                  <button
                    onClick={() => setConsoleQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-noxara-muted hover:text-noxara-text"
                    aria-label="Clear search"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
              <button
                onClick={() => setFollowOutput((f) => !f)}
                className={`text-xs px-2 py-1 rounded transition-colors ${
                  followOutput
                    ? "bg-noxara-elevated text-noxara-text"
                    : "text-noxara-muted hover:text-noxara-text"
                }`}
                title="Toggle auto-scroll to the latest output"
              >
                Follow
              </button>
              <button
                onClick={() =>
                  navigator.clipboard.writeText(logs.map((e) => e.line).join("\n"))
                }
                disabled={logs.length === 0}
                className="text-xs px-2 py-1 rounded text-noxara-muted hover:text-noxara-text disabled:opacity-40"
                title="Copy all console output"
              >
                <Copy size={12} /> Copy
              </button>
              <button
                onClick={() => id && clearLog(id)}
                disabled={logs.length === 0}
                className="text-xs px-2 py-1 rounded text-noxara-muted hover:text-noxara-error disabled:opacity-40"
                title="Clear console"
              >
                <Trash2 size={12} /> Clear
              </button>
            </div>
          </div>
          <div
            ref={logRef}
            className="h-96 overflow-y-auto font-mono text-xs whitespace-pre-wrap px-3 py-2 bg-noxara-black/40"
          >
            {filteredLogs.length === 0 ? (
              <p className="text-noxara-muted">
                {consoleQuery
                  ? "No console lines match that search."
                  : "No output yet. Launch the instance to see live console output here."}
              </p>
            ) : (
              filteredLogs.map((entry, idx) => (
                <div key={idx} className={consoleLineClass(entry)}>
                  <span className="text-noxara-muted/70 select-none mr-2">
                    {new Date(entry.timestamp).toLocaleTimeString(undefined, {
                      hour12: false,
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>
                  {entry.line}
                </div>
              ))
            )}
          </div>
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

/** Per-instance Java runtime picker: lists every Java the core detects and lets the
 * user pin one (or revert to auto-detection, which picks the best fit for the
 * instance's Minecraft version at launch time). */
function JavaSelector({
  current,
  onChanged,
}: {
  current: string | null;
  onChanged: (path: string | null) => void | Promise<void>;
}) {
  const [runtimes, setRuntimes] = useState<JavaInstallation[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.noxara
      .detectJava()
      .then(setRuntimes)
      .catch(() => setRuntimes([]))
      .finally(() => setLoading(false));
  }, []);

  // When the pinned path isn't among the detected runtimes (e.g. the runtime was
  // uninstalled), show a placeholder so the select never silently falls back.
  const pinnedMissing = current !== null && !runtimes.some((r) => r.path === current);

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value === "" ? null : e.target.value;
    setSaving(true);
    try {
      await onChanged(next);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="yz-card px-4 py-3">
      <div className="flex items-center justify-between mb-1">
        <span className="yz-label">Java Runtime</span>
        {saving && <Loader2 size={12} className="animate-spin text-noxara-muted" />}
      </div>
      <select
        className="yz-select w-full text-xs"
        value={pinnedMissing ? "__missing" : (current ?? "")}
        onChange={handleChange}
        disabled={saving}
      >
        <option value="">Auto-detect (recommended)</option>
        {loading && (
          <option value="__scanning" disabled>
            Scanning for Java…
          </option>
        )}
        {runtimes.map((r) => (
          <option key={r.path} value={r.path}>
            Java {r.majorVersion} · {r.vendor ?? "Unknown"} · {r.version}
          </option>
        ))}
        {pinnedMissing && (
          <option value="__missing" disabled>
            Pinned runtime no longer detected: {current}
          </option>
        )}
      </select>
      <p className="text-[11px] text-noxara-muted mt-1.5">
        Auto-detect picks the best Java for this Minecraft version at launch. Pin one here to override.
      </p>
    </div>
  );
}

/** Colors a console line: stderr and anything that looks like an error/exception is
 * red, warnings amber, everything else the subtle base color. Launcher-originated
 * messages are delivered as stderr so they're always highlighted. */
function consoleLineClass(entry: ConsoleLine): string {
  if (entry.stream === "stderr") return "text-noxara-error";
  const text = entry.line;
  if (/error|exception|severe|fatal|failed|at net\.|java\.lang/i.test(text)) return "text-noxara-error";
  if (/warn|warning/i.test(text)) return "text-noxara-warning";
  return "text-noxara-subtle";
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

/** Backups for one instance: create a zip snapshot, list them, restore or delete.
 * Restore asks for confirmation since it replaces the instance's files. */
function BackupsTab({ instanceId }: { instanceId: string }) {
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setBackups(await window.noxara.listBackups(instanceId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load backups");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  async function handleCreate() {
    if (!label.trim()) {
      toast.error("Give the backup a label first");
      return;
    }
    setBusy(true);
    try {
      await window.noxara.createBackup(instanceId, label);
      toast.success("Backup created");
      setLabel("");
      await refresh();
    } catch (e) {
      toast.error("Backup failed", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function handleRestore(b: BackupRecord) {
    const ok = window.confirm(
      `Restore "${b.label}"?\n\nThis replaces the instance's current files with the snapshot from ${new Date(
        b.createdAt
      ).toLocaleString()}. Make a fresh backup first if you might want the current state back.`
    );
    if (!ok) return;
    setBusy(true);
    try {
      await window.noxara.restoreBackup(b.id);
      toast.success("Backup restored");
      await refresh();
    } catch (e) {
      toast.error("Restore failed", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(b: BackupRecord) {
    if (!window.confirm(`Delete backup "${b.label}"? This can't be undone.`)) return;
    try {
      await window.noxara.deleteBackup(b.id);
      toast.success("Backup deleted");
      await refresh();
    } catch (e) {
      toast.error("Couldn't delete backup", e instanceof Error ? e.message : undefined);
    }
  }

  return (
    <div className="space-y-3">
      <div className="yz-card px-4 py-3">
        <div className="yz-label mb-1.5">Create a backup</div>
        <div className="flex gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
            }}
            placeholder="e.g. Before installing shaders"
            className="yz-input flex-1"
            disabled={busy}
          />
          <button
            onClick={handleCreate}
            disabled={busy || !label.trim()}
            className="yz-btn-primary text-xs px-3 py-2 flex items-center gap-1.5 disabled:opacity-40"
          >
            <Plus size={13} />
            Backup
          </button>
        </div>
        <p className="text-[11px] text-noxara-muted mt-1.5">
          A full snapshot of this instance's folder. You can restore it at any time.
        </p>
      </div>

      {error && <p className="text-sm text-noxara-error">{error}</p>}

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="yz-skeleton h-14 rounded-md" />
          ))}
        </div>
      ) : backups.length === 0 ? (
        <div className="yz-card px-4 py-6 text-center text-sm text-noxara-muted">
          <Archive size={20} className="mx-auto mb-2 text-noxara-subtle" />
          No backups yet. Create one to snapshot this instance.
        </div>
      ) : (
        <div className="space-y-2">
          {backups.map((b) => (
            <div key={b.id} className="yz-card px-3.5 py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0 flex items-center gap-2.5">
                <Archive size={15} className="text-noxara-subtle shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm text-noxara-text truncate">{b.label}</div>
                  <div className="text-xs text-noxara-muted">
                    {new Date(b.createdAt).toLocaleString()} · {formatBytes(b.sizeBytes)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  onClick={() => handleRestore(b)}
                  disabled={busy}
                  className="yz-btn-secondary text-xs px-2.5 py-1 flex items-center gap-1 disabled:opacity-40"
                >
                  <Download size={12} />
                  Restore
                </button>
                <button
                  onClick={() => handleDelete(b)}
                  disabled={busy}
                  className="yz-btn-ghost text-xs px-2 py-1 text-noxara-error disabled:opacity-40"
                  aria-label={`Delete backup ${b.label}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
