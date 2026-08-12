import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Play,
  Plus,
  Boxes,
  X,
  Loader2,
  Puzzle,
  Package,
  Image,
  Sparkles,
  Server,
  Download,
  Clock,
  Layers,
  Cpu,
  ArrowRight,
} from "lucide-react";
import type { InstanceRecord } from "@shared/types/ipc";
import { InstanceCover } from "../components/InstanceCover";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { useAccountStore } from "../stores/useAccountStore";
import { launchInstance, useLaunchStore } from "../stores/useLaunchStore";
import { useDownloadStore, selectActiveDownloads, formatBytes, formatSpeed, formatEta } from "../stores/useDownloadStore";
import { toast } from "../stores/useToastStore";

function loaderLabel(loader: InstanceRecord["loader"]): string {
  if (loader === "vanilla") return "Vanilla";
  return loader === "neoforge" ? "NeoForge" : loader === "quilt" ? "Quilt" : loader.charAt(0).toUpperCase() + loader.slice(1);
}

function timeAgo(iso: string | null): string {
  if (!iso) return "Never played";
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return "Never played";
  const s = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d > 1 ? "s" : ""} ago`;
  return new Date(iso).toLocaleDateString();
}

function ProgressBar({ percent, tone = "default" }: { percent: number; tone?: "default" | "error" }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="h-1 rounded-full bg-noxara-elevated overflow-hidden">
      <div
        className={`h-full rounded-full transition-[width] duration-300 ease-out ${
          tone === "error" ? "bg-noxara-error" : "bg-noxara-white"
        }`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function percentOf(d: { bytesDownloaded: number; totalBytes: number; status: string }): number {
  if (d.totalBytes > 0) return Math.round((d.bytesDownloaded / d.totalBytes) * 100);
  return d.status === "downloading" ? 90 : 100;
}

/* -------------------------------------------------------------------------- */
/* Hero banner                                                                */
/* -------------------------------------------------------------------------- */

function HeroBanner() {
  return (
    <div className="relative overflow-hidden rounded-lg border border-noxara-border mb-4 animate-fade-in">
      {/* Background artwork — generated, monochrome, matches Noxara's identity.
          A soft radial "moon" glows behind the wordmark so the banner reads as a
          deliberate visual focus without fighting the dark/minimal design. */}
      <div className="absolute inset-0 bg-noxara-black" />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 70% 90% at 78% 20%, rgba(255,255,255,0.07), transparent 60%)," +
            "radial-gradient(ellipse 50% 60% at 15% 85%, rgba(255,255,255,0.04), transparent 65%)",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.05]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />
      <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 px-5 py-6 md:px-7 md:py-7">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[10px] yz-label">www.noxara.com</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-noxara-white">
            <span className="opacity-90">NOXARA</span>
          </h1>
          <p className="text-sm md:text-base text-noxara-subtle mt-1 max-w-md">
            Manage, install and launch everything from one place.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
          <Link to="/instances" className="yz-btn-primary flex-1 sm:flex-none">
            <Boxes size={16} /> Explore Instances
          </Link>
          <Link to="/servers" className="yz-btn-secondary flex-1 sm:flex-none">
            <Server size={16} /> Servers
          </Link>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Continue Playing                                                           */
/* -------------------------------------------------------------------------- */

function ContinuePlayingCard({ instance }: { instance: InstanceRecord }) {
  const runningIds = useLaunchStore((s) => s.runningInstanceIds);
  const launchingIds = useLaunchStore((s) => s.launchingInstanceIds);
  const kill = useLaunchStore((s) => s.kill);
  const [modCount, setModCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.noxara
      .listInstalledMods(instance.id)
      .then((mods) => {
        if (!cancelled) setModCount(mods.length);
      })
      .catch(() => {
        if (!cancelled) setModCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [instance.id]);

  const running = runningIds.has(instance.id);
  const launching = launchingIds.has(instance.id);

  async function handlePlay() {
    try {
      await launchInstance(instance.id);
    } catch (e) {
      toast.error("Could not launch Minecraft", e instanceof Error ? e.message : undefined);
    }
  }
  async function handleKill() {
    try {
      await kill(instance.id);
      toast.success("Instance stopped");
    } catch (e) {
      toast.error("Couldn't stop instance", e instanceof Error ? e.message : undefined);
    }
  }

  return (
    <div className="relative overflow-hidden rounded-lg border border-noxara-border animate-fade-in">
      <InstanceCover loader={instance.loader} className="absolute inset-0 rounded-none border-0" />
      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/30" />
      <div className="relative flex flex-col md:flex-row md:items-end gap-4 p-4 md:p-5 min-h-[10rem]">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
            <span className="text-[10px] yz-label">Continue Playing</span>
            <span className="text-[10px] font-medium bg-noxara-white/10 text-noxara-subtle px-1.5 py-0.5 rounded-full">
              {loaderLabel(instance.loader)}
            </span>
            {running && (
              <span className="flex items-center gap-1 text-[10px] font-medium bg-noxara-success/10 text-noxara-success px-1.5 py-0.5 rounded-full">
                <span className="w-1 h-1 rounded-full bg-noxara-success animate-pulse" /> RUNNING
              </span>
            )}
          </div>
          <div className="text-xl md:text-2xl font-semibold text-noxara-white truncate">{instance.name}</div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-noxara-subtle mt-1.5">
            <span className="inline-flex items-center gap-1">
              <Cpu size={12} /> Minecraft {instance.minecraftVersion}
            </span>
            <span className="inline-flex items-center gap-1">
              <Layers size={12} />
              {loaderLabel(instance.loader)}
              {instance.loaderVersion ? ` ${instance.loaderVersion}` : ""}
            </span>
            {modCount !== null && (
              <span className="inline-flex items-center gap-1">{modCount} mod{modCount === 1 ? "" : "s"}</span>
            )}
            <span className="inline-flex items-center gap-1">
              <Clock size={12} /> {timeAgo(instance.lastPlayedAt)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {running ? (
            <button onClick={handleKill} className="yz-btn-danger">
              <X size={16} /> Kill Instance
            </button>
          ) : (
            <button onClick={handlePlay} disabled={launching} className="yz-btn-primary px-6">
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
          <Link to={`/instances/${instance.id}`} className="yz-btn-secondary bg-black/30 backdrop-blur-sm">
            Details
          </Link>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Featured instance card                                                     */
/* -------------------------------------------------------------------------- */

function InstanceCard({ instance, index }: { instance: InstanceRecord; index: number }) {
  const runningIds = useLaunchStore((s) => s.runningInstanceIds);
  const launchingIds = useLaunchStore((s) => s.launchingInstanceIds);
  const kill = useLaunchStore((s) => s.kill);
  const [modCount, setModCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.noxara
      .listInstalledMods(instance.id)
      .then((mods) => {
        if (!cancelled) setModCount(mods.length);
      })
      .catch(() => {
        if (!cancelled) setModCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [instance.id]);

  const running = runningIds.has(instance.id);
  const launching = launchingIds.has(instance.id);

  async function handlePlay() {
    try {
      await launchInstance(instance.id);
    } catch (e) {
      toast.error("Could not launch Minecraft", e instanceof Error ? e.message : undefined);
    }
  }
  async function handleKill() {
    try {
      await kill(instance.id);
    } catch (e) {
      toast.error("Couldn't stop instance", e instanceof Error ? e.message : undefined);
    }
  }

  return (
    <div
      className="group rounded-md overflow-hidden border border-noxara-border hover:border-noxara-border-strong hover:-translate-y-0.5 hover:shadow-card-hover transition-all duration-200 bg-noxara-surface animate-fade-in"
      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
    >
      <Link to={`/instances/${instance.id}`} className="block focus:outline-none">
        <div className="relative">
          <InstanceCover loader={instance.loader} className="w-full aspect-video rounded-none border-0" compact />
          {instance.favorite && (
            <span className="absolute top-1.5 left-1.5 text-[9px] font-medium bg-black/70 backdrop-blur-sm text-noxara-white px-1.5 py-0.5 rounded">
              ★
            </span>
          )}
          {running && (
            <span className="absolute top-1.5 right-1.5 flex items-center gap-1 text-[9px] font-medium bg-black/70 backdrop-blur-sm text-noxara-success px-1.5 py-0.5 rounded">
              <span className="w-1 h-1 rounded-full bg-noxara-success animate-pulse" /> RUNNING
            </span>
          )}
        </div>
        <div className="px-2.5 pt-2 pb-1">
          <div className="text-sm font-medium truncate group-hover:text-noxara-white transition-colors">{instance.name}</div>
          <div className="text-[11px] text-noxara-muted truncate mt-0.5">
            Minecraft {instance.minecraftVersion} · {loaderLabel(instance.loader)}
          </div>
          <div className="flex items-center gap-1 text-[11px] text-noxara-muted mt-0.5">
            {modCount !== null && (
              <span>
                {modCount} mod{modCount === 1 ? "" : "s"}
              </span>
            )}
            {instance.lastPlayedAt && (
              <span className="inline-flex items-center gap-0.5">
                {modCount !== null && <span>·</span>}
                <Clock size={10} /> {timeAgo(instance.lastPlayedAt)}
              </span>
            )}
          </div>
        </div>
      </Link>
      <div className="px-2.5 pb-2.5">
        {running ? (
          <button
            onClick={handleKill}
            className="w-full yz-btn-danger !py-1.5 text-xs"
            aria-label={`Stop ${instance.name}`}
          >
            <X size={13} /> Stop
          </button>
        ) : (
          <button
            onClick={handlePlay}
            disabled={launching}
            className="w-full yz-btn-secondary !py-1.5 text-xs"
            aria-label={`Play ${instance.name}`}
          >
            {launching ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Launching…
              </>
            ) : (
              <>
                <Play size={13} /> Play
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Quick actions                                                              */
/* -------------------------------------------------------------------------- */

const QUICK_ACTIONS = [
  { to: "/instances", label: "Create Instance", icon: Plus },
  { to: "/modpacks", label: "Modpacks", icon: Package },
  { to: "/mods", label: "Browse Mods", icon: Puzzle },
  { to: "/resourcepacks", label: "Resource Packs", icon: Image },
  { to: "/shaders", label: "Shaders", icon: Sparkles },
  { to: "/servers", label: "Servers", icon: Server },
] as const;

function QuickActions() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {QUICK_ACTIONS.map(({ to, label, icon: Icon }, i) => (
        <Link
          key={to}
          to={to}
          className="inline-flex items-center gap-2 yz-btn-ghost !px-3 !py-1.5 text-xs border border-transparent hover:border-noxara-border rounded-md animate-fade-in"
          style={{ animationDelay: `${i * 30}ms` }}
        >
          <Icon size={14} className="text-noxara-muted" />
          {label}
        </Link>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Downloads section                                                          */
/* -------------------------------------------------------------------------- */

function DownloadsSection() {
  const downloads = useDownloadStore((s) => s.downloads);
  const forgeInstalls = useDownloadStore((s) => s.forgeInstalls);
  const active = selectActiveDownloads(downloads);
  const activeForge = forgeInstalls.filter((f) => f.status === "installing");

  if (active.length === 0 && activeForge.length === 0) return null;

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-xs yz-label inline-flex items-center gap-1.5">
          <Download size={12} /> Downloads
        </div>
        <Link to="/downloads" className="text-[11px] text-noxara-muted hover:text-noxara-text inline-flex items-center gap-1 transition-colors">
          View all <ArrowRight size={11} />
        </Link>
      </div>
      <div className="space-y-2">
        {activeForge.map((f) =>
          f.status === "installing" ? (
            <div key={f.taskId} className="yz-card px-4 py-3">
              <div className="flex items-center gap-2 mb-1.5 text-sm text-noxara-text">
                <Loader2 size={14} className="animate-spin text-noxara-subtle shrink-0" />
                <span className="truncate">{f.message || "Installing loader"}</span>
              </div>
              <div className="text-xs text-noxara-muted capitalize truncate">{f.stage || "working"}</div>
            </div>
          ) : null
        )}
        {active.map((d) => {
          const percent = percentOf(d);
          const speed = formatSpeed(d.bytesPerSec);
          const eta = formatEta(d.etaSeconds);
          const meta = d.kind === "batch" && (d.fileCount ?? 0) > 1 ? ` · file ${d.fileIndex ?? 0}/${d.fileCount ?? 0}` : "";
          return (
            <div key={d.taskId} className="yz-card px-4 py-3">
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <div className="flex items-center gap-2 text-sm text-noxara-text min-w-0">
                  <Loader2 size={14} className="animate-spin text-noxara-subtle shrink-0" />
                  <span className="truncate">{d.name}</span>
                </div>
                <span className="text-xs text-noxara-muted shrink-0 tabular-nums">
                  {formatBytes(d.bytesDownloaded)}
                  {d.totalBytes > 0 ? ` / ${formatBytes(d.totalBytes)}` : ""}
                  {meta}
                </span>
              </div>
              <ProgressBar percent={percent} />
              <div className="flex items-center justify-between mt-1 text-[11px] text-noxara-muted">
                <span>
                  {d.status === "completed"
                    ? "Completed"
                    : d.totalBytes > 0
                      ? `${percent}%`
                      : "Downloading…"}
                  {d.kind === "batch" && d.totalBytes > 0 && ` · overall`}
                </span>
                <span className="tabular-nums">
                  {speed && <span>{speed}</span>}
                  {speed && eta && <span> · </span>}
                  {eta && <span>ETA {eta}</span>}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function HomePage() {
  const [instances, setInstances] = useState<InstanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { hasLoaded, refresh, activeAccount } = useAccountStore();
  const account = activeAccount();

  useEffect(() => {
    window.noxara
      .listInstances()
      .then((list) => {
        setInstances(list);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Failed to load instances");
        setLoading(false);
      });
    if (!hasLoaded) refresh();
  }, [hasLoaded, refresh]);

  // Most recently played first; never-played instances sink to the bottom.
  const byRecency = useMemo(
    () =>
      [...instances].sort((a, b) => {
        const at = a.lastPlayedAt ? new Date(a.lastPlayedAt).getTime() : -1;
        const bt = b.lastPlayedAt ? new Date(b.lastPlayedAt).getTime() : -1;
        return bt - at;
      }),
    [instances]
  );

  const continueInstance = byRecency.find((i) => i.lastPlayedAt) ?? null;
  const recents = useMemo(() => {
    if (!continueInstance) return [];
    return byRecency.filter((i) => i.id !== continueInstance.id && i.lastPlayedAt).slice(0, 6);
  }, [byRecency, continueInstance]);

  // Featured = the rest of the library, favorites first, then newest, so it stays
  // a *discovery* grid rather than a duplicate of Continue Playing / Recently Played.
  const featured = useMemo(() => {
    const occupied = new Set([...(continueInstance ? [continueInstance.id] : []), ...recents.map((r) => r.id)]);
    const remaining = instances.filter((i) => !occupied.has(i.id));
    return [...remaining]
      .sort((a, b) => {
        if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      })
      .slice(0, 8);
  }, [instances, continueInstance, recents]);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  if (loading) {
    return (
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <div className="yz-skeleton h-28 md:h-32 rounded-lg mb-4" />
        <div className="yz-skeleton h-28 rounded-lg mb-4" />
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2 mb-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <div className="yz-skeleton aspect-video rounded-md mb-1.5" />
              <div className="yz-skeleton h-3.5 w-3/4 rounded mb-1" />
              <div className="yz-skeleton h-3 w-1/2 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      <PageHeader
        title={account ? `${greeting}, ${account.username}` : greeting}
        actions={
          <Link to="/instances" className="yz-btn-secondary hidden sm:inline-flex">
            <Plus size={16} /> New Instance
          </Link>
        }
      />

      {error && (
        <div className="yz-card border-noxara-error/40 bg-noxara-error/5 px-4 py-2.5 text-sm text-noxara-error flex items-center justify-between gap-3">
          <span className="truncate">{error}</span>
          <button
            onClick={() => {
              setLoading(true);
              setError(null);
              window.noxara
                .listInstances()
                .then((list) => {
                  setInstances(list);
                  setLoading(false);
                })
                .catch((e) => {
                  setError(e instanceof Error ? e.message : "Failed to load instances");
                  setLoading(false);
                });
            }}
            className="text-xs text-noxara-error/80 hover:text-noxara-error underline underline-offset-2 shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      <HeroBanner />

      {instances.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No instances yet"
          description="Create your first instance to start playing Minecraft."
          action={
            <Link to="/instances" className="yz-btn-primary inline-flex">
              Create your first instance
            </Link>
          }
        />
      ) : (
        <>
          {continueInstance ? (
            <section aria-label="Continue playing">
              <ContinuePlayingCard instance={continueInstance} />
            </section>
          ) : (
            <div className="yz-card px-4 py-3 flex items-center justify-between gap-3">
              <div className="text-sm text-noxara-text">
                Play something to pick up where you left off — recently played instances appear here.
              </div>
              <Link to="/instances" className="yz-btn-secondary shrink-0">
                <Plus size={15} /> Create Instance
              </Link>
            </div>
          )}

          <section aria-label="Quick actions">
            <p className="text-xs yz-label mb-2">Quick Actions</p>
            <QuickActions />
          </section>

          {featured.length > 0 && (
            <section aria-label="Featured instances">
              <p className="text-xs yz-label mb-2">Featured Instances</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
                {featured.map((i, idx) => (
                  <InstanceCard key={i.id} instance={i} index={idx} />
                ))}
              </div>
            </section>
          )}

          {recents.length > 0 && (
            <section aria-label="Recently played">
              <p className="text-xs yz-label mb-2">Recently Played</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2">
                {recents.map((i, idx) => (
                  <InstanceCard key={i.id} instance={i} index={idx} />
                ))}
              </div>
            </section>
          )}

          <DownloadsSection />
        </>
      )}
    </div>
  );
}