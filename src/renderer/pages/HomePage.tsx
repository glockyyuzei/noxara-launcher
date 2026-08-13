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
import { InstanceStateBadge } from "../components/InstanceStateBadge";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { useAccountStore } from "../stores/useAccountStore";
import { launchInstance, useLaunchStore } from "../stores/useLaunchStore";
import { useInstanceState } from "../stores/useInstanceState";
import { useActivityStore } from "../stores/useActivityStore";
import { selectActive } from "../components/ActivityIndicator";
import { formatBytes, formatSpeed, formatEta } from "../utils/format";
import { friendlyErrorMessage } from "../lib/coreErrors";
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

function percentOf(a: { progress: { progress?: number; currentBytes?: number; totalBytes?: number } }): number {
  const p = a.progress;
  const pct = p.progress;
  if (pct !== undefined && pct >= 0) return Math.round(Math.min(1, pct) * 100);
  const total = p.totalBytes ?? 0;
  const current = p.currentBytes ?? 0;
  if (total > 0) return Math.round((current / total) * 100);
  return 90;
}

/* -------------------------------------------------------------------------- */
/* Hero banner                                                                */
/* -------------------------------------------------------------------------- */

function HeroBanner() {
  const [bannerOk, setBannerOk] = useState(true);
  const [ratio, setRatio] = useState<number | null>(null);

  return (
    <div
      className="relative overflow-hidden rounded-lg border border-noxara-border animate-fade-in"
      style={{ aspectRatio: ratio !== null ? `${ratio} / 1` : "2 / 1" }}
    >
      {/* Fallback artwork — only visible until a custom banner is placed at
          src/renderer/public/noxara_banner.png (1774 x 887). */}
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
      {bannerOk && (
        <img
          src="./noxara_banner.png"
          alt="Noxara banner"
          className="absolute inset-0 w-full h-full object-cover"
          onError={() => setBannerOk(false)}
          onLoad={(e) => {
            const el = e.currentTarget;
            if (el.naturalWidth > 0 && el.naturalHeight > 0) {
              setRatio(el.naturalWidth / el.naturalHeight);
            }
          }}
        />
      )}
      {/* Gentle scrim at the bottom so the action buttons stay readable on any artwork. */}
      <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-noxara-black/60 to-transparent" />
      <div className="absolute bottom-0 left-0 flex items-center gap-2 p-4 md:p-5">
        <Link to="/instances" className="yz-btn-primary">
          <Boxes size={16} /> Explore Instances
        </Link>
        <Link to="/servers" className="yz-btn-secondary">
          <Server size={16} /> Servers
        </Link>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Continue Playing                                                           */
/* -------------------------------------------------------------------------- */

function ContinuePlayingCard({ instance }: { instance: InstanceRecord }) {
  const state = useInstanceState(instance.id);
  const running = state === "RUNNING" || state === "STOPPING";
  const launching = state === "LAUNCHING" || state === "DOWNLOADING" || state === "INSTALLING";
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

  async function handlePlay() {
    try {
      await launchInstance(instance.id);
    } catch (e) {
      toast.error("Could not launch Minecraft", friendlyErrorMessage(e));
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
    <div className="yz-card overflow-hidden animate-fade-in">
      <div className="px-4 py-3.5 md:px-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <span className="text-xs yz-label">Continue Playing</span>
          <Link
            to={`/instances/${instance.id}`}
            className="inline-flex items-center gap-1 text-[11px] text-noxara-muted hover:text-noxara-text transition-colors"
          >
            View details <ArrowRight size={11} />
          </Link>
        </div>
        <div className="flex items-center gap-3 md:gap-4">
          <div className="relative shrink-0">
            <InstanceCover loader={instance.loader} className="w-16 h-16 md:w-20 md:h-20 rounded-lg" compact />
            <span className="absolute -top-1 -right-1">
              <InstanceStateBadge instanceId={instance.id} />
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              <span className="text-base md:text-lg font-semibold text-noxara-white truncate">{instance.name}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-noxara-subtle">
              <span className="inline-flex items-center gap-1">
                <Cpu size={11} /> Minecraft {instance.minecraftVersion}
              </span>
              <span className="inline-flex items-center gap-1">
                <Layers size={11} />
                {loaderLabel(instance.loader)}
                {instance.loaderVersion ? ` ${instance.loaderVersion}` : ""}
              </span>
              {modCount !== null && (
                <span>
                  {modCount} mod{modCount === 1 ? "" : "s"}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <Clock size={11} /> {timeAgo(instance.lastPlayedAt)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {running ? (
              <button onClick={handleKill} className="yz-btn-danger">
                <X size={15} /> Kill Instance
              </button>
            ) : (
              <button onClick={handlePlay} disabled={launching} className="yz-btn-primary px-5">
                {launching ? (
                  <>
                    <Loader2 size={15} className="animate-spin" /> Launching…
                  </>
                ) : (
                  <>
                    <Play size={15} /> Play
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Featured instance card                                                     */
/* -------------------------------------------------------------------------- */

function InstanceCard({ instance, index }: { instance: InstanceRecord; index: number }) {
  const state = useInstanceState(instance.id);
  const running = state === "RUNNING" || state === "STOPPING";
  const launching = state === "LAUNCHING" || state === "DOWNLOADING" || state === "INSTALLING";
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

  async function handlePlay() {
    try {
      await launchInstance(instance.id);
    } catch (e) {
      toast.error("Could not launch Minecraft", friendlyErrorMessage(e));
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
          <span className="absolute top-1.5 right-1.5">
            <InstanceStateBadge instanceId={instance.id} />
          </span>
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
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      {QUICK_ACTIONS.map(({ to, label, icon: Icon }, i) => (
        <Link
          key={to}
          to={to}
          className="inline-flex items-center justify-center gap-2 yz-btn-ghost !px-3 !py-2 text-xs border border-transparent hover:border-noxara-border rounded-md animate-fade-in"
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
  const activities = useActivityStore((s) => s.activities);
  const active = selectActive(activities);

  if (active.length === 0) return null;

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
        {active.map((a) => {
          const percent = percentOf(a);
          const speed = formatSpeed(a.progress.speedBytesPerSec);
          const eta = formatEta(a.progress.etaSeconds);
          const total = a.progress.totalBytes ?? 0;
          const current = a.progress.currentBytes ?? 0;
          const meta =
            a.progress.completedFiles !== undefined && a.progress.totalFiles !== undefined && a.progress.totalFiles > 0
              ? ` · file ${a.progress.completedFiles}/${a.progress.totalFiles}`
              : total > 0
                ? ` · ${formatBytes(current)} / ${formatBytes(total)}`
                : "";
          return (
            <div key={a.id} className="yz-card px-4 py-3">
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <div className="flex items-center gap-2 text-sm text-noxara-text min-w-0">
                  <Loader2 size={14} className="animate-spin text-noxara-subtle shrink-0" />
                  <span className="truncate">{a.title}</span>
                </div>
                <span className="text-xs text-noxara-muted shrink-0 tabular-nums">
                  {total > 0 ? `${formatBytes(current)} / ${formatBytes(total)}` : a.description ?? ""}
                  {meta}
                </span>
              </div>
              <ProgressBar percent={percent} />
              <div className="flex items-center justify-between mt-1 text-[11px] text-noxara-muted">
                <span className="truncate">
                  {a.description ??
                    (a.progress.progress !== undefined || (a.progress.totalBytes ?? 0) > 0 ? `${percent}%` : "In progress…")}
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
      <div className="p-4 md:p-6 w-full">
        <div className="yz-skeleton h-28 md:h-32 rounded-lg mb-4" />
        <div className="yz-skeleton h-16 rounded-lg mb-4" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 mb-4">
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
    <div className="p-4 md:p-6 w-full space-y-5">
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
              <div className="flex items-center gap-3 text-sm text-noxara-text min-w-0">
                <span className="text-xs yz-label shrink-0">Continue Playing</span>
                <span className="hidden sm:inline text-xs text-noxara-muted truncate">No instances played yet</span>
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
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                {featured.map((i, idx) => (
                  <InstanceCard key={i.id} instance={i} index={idx} />
                ))}
              </div>
            </section>
          )}

          <section aria-label="Recently played">
            <p className="text-xs yz-label mb-2">Recently Played</p>
            {recents.length > 0 ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                {recents.map((i, idx) => (
                  <InstanceCard key={i.id} instance={i} index={idx} />
                ))}
              </div>
            ) : (
              <div className="yz-card px-4 py-3 text-sm text-noxara-text">
                Instances you play will show up here for quick access.
              </div>
            )}
          </section>

          <DownloadsSection />
        </>
      )}
    </div>
  );
}