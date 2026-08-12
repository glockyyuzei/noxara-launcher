import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Play, Plus, Boxes, X, Loader2 } from "lucide-react";
import type { InstanceRecord } from "@shared/types/ipc";
import { InstanceCover } from "../components/InstanceCover";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { useAccountStore } from "../stores/useAccountStore";
import { launchInstance, useLaunchStore } from "../stores/useLaunchStore";
import { toast } from "../stores/useToastStore";

export default function HomePage() {
  const [instances, setInstances] = useState<InstanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const launchingIds = useLaunchStore((s) => s.launchingInstanceIds);
  const runningIds = useLaunchStore((s) => s.runningInstanceIds);
  const kill = useLaunchStore((s) => s.kill);

  const { hasLoaded, refresh, activeAccount } = useAccountStore();
  const account = activeAccount();

  useEffect(() => {
    window.noxara.listInstances().then((list) => {
      setInstances(list);
      setLoading(false);
    });
    if (!hasLoaded) refresh();
  }, [hasLoaded, refresh]);

  const byRecency = [...instances].sort((a, b) => {
    const at = a.lastPlayedAt ? new Date(a.lastPlayedAt).getTime() : -1;
    const bt = b.lastPlayedAt ? new Date(b.lastPlayedAt).getTime() : -1;
    return bt - at;
  });
  const featured = byRecency[0];
  const recents = byRecency.slice(1).slice(0, 8);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  async function handlePlay(id: string) {
    setError(null);
    try {
      await launchInstance(id);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to launch";
      setError(message);
      toast.error("Could not launch Minecraft", message);
    }
  }

  async function handleKill(id: string) {
    try {
      await kill(id);
      toast.success("Instance stopped");
    } catch (e) {
      toast.error("Couldn't stop instance", e instanceof Error ? e.message : undefined);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader
        title={account ? `${greeting}, ${account.username}` : greeting}
        actions={
          <Link to="/instances" className="yz-btn-secondary hidden sm:inline-flex">
            <Plus size={16} /> New Instance
          </Link>
        }
      />

      {error && (
        <div className="mb-4 yz-card border-noxara-error/40 bg-noxara-error/5 px-4 py-2.5 text-sm text-noxara-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="yz-skeleton rounded-md h-40 md:h-48 mb-4" />
      ) : featured ? (
        <div className="relative rounded-md overflow-hidden border border-noxara-border mb-4 h-40 md:h-48">
          <InstanceCover loader={featured.loader} className="absolute inset-0 rounded-none border-0" />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
          <div className="relative h-full flex flex-col justify-end p-4 md:p-5">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] yz-label text-noxara-subtle">Featured Instance</span>
              {runningIds.has(featured.id) && (
                <span className="flex items-center gap-1 text-[10px] font-medium bg-noxara-success/10 text-noxara-success px-1.5 py-0.5 rounded-full">
                  <span className="w-1 h-1 rounded-full bg-noxara-success animate-pulse" /> RUNNING
                </span>
              )}
            </div>
            <div className="text-xl md:text-2xl font-semibold text-noxara-white mb-0.5 truncate">{featured.name}</div>
            <div className="text-sm text-noxara-subtle mb-2">
              Minecraft {featured.minecraftVersion} · {featured.loader === "vanilla" ? "Vanilla" : featured.loader}
            </div>
            <div className="flex gap-2">
              {runningIds.has(featured.id) ? (
                <button onClick={() => handleKill(featured.id)} className="yz-btn-danger px-5">
                  <X size={16} /> Kill Instance
                </button>
              ) : (
                <button
                  onClick={() => handlePlay(featured.id)}
                  disabled={launchingIds.has(featured.id)}
                  className="yz-btn-primary px-6"
                >
                  {launchingIds.has(featured.id) ? (
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
              <Link to={`/instances/${featured.id}`} className="yz-btn-secondary bg-black/30 backdrop-blur-sm">
                Details
              </Link>
            </div>
          </div>
        </div>
      ) : (
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
      )}

      {recents.length > 0 && (
        <div>
          <div className="text-xs yz-label mb-1.5">Recently Played</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2">
            {recents.map((i) => (
              <Link
                key={i.id}
                to={`/instances/${i.id}`}
                className="group rounded-md overflow-hidden border border-noxara-border hover:border-noxara-border-strong hover:-translate-y-0.5 hover:shadow-card-hover transition-all duration-200"
              >
                <div className="relative">
                  <InstanceCover loader={i.loader} className="w-full aspect-video rounded-none border-0" compact />
                  {runningIds.has(i.id) && (
                    <span className="absolute top-1.5 right-1.5 flex items-center gap-1 text-[9px] font-medium bg-black/70 backdrop-blur-sm text-noxara-success px-1.5 py-0.5 rounded">
                      <span className="w-1 h-1 rounded-full bg-noxara-success animate-pulse" /> RUNNING
                    </span>
                  )}
                  {launchingIds.has(i.id) && (
                    <span className="absolute top-1.5 right-1.5 flex items-center gap-1 text-[9px] font-medium bg-black/70 backdrop-blur-sm text-noxara-white px-1.5 py-0.5 rounded">
                      <Loader2 size={8} className="animate-spin" /> LAUNCHING
                    </span>
                  )}
                </div>
                <div className="bg-noxara-surface px-2 py-1.5">
                  <div className="text-sm font-medium truncate group-hover:text-noxara-white transition-colors">
                    {i.name}
                  </div>
                  <div className="text-[11px] text-noxara-muted truncate">{i.minecraftVersion}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
