import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Play, Plus } from "lucide-react";
import type { InstanceRecord } from "@shared/types/ipc";
import { InstanceCover } from "../components/InstanceCover";
import { useAccountStore } from "../stores/useAccountStore";
import { toast } from "../stores/useToastStore";

export default function HomePage() {
  const [instances, setInstances] = useState<InstanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { hasLoaded, refresh, activeAccount } = useAccountStore();
  const account = activeAccount();

  useEffect(() => {
    window.noxara.listInstances().then((list) => {
      setInstances(list);
      setLoading(false);
    });
    if (!hasLoaded) refresh();
  }, [hasLoaded, refresh]);

  const featured = instances.find((i) => i.lastPlayedAt) ?? instances[0];
  const recents = instances.filter((i) => i.id !== featured?.id).slice(0, 8);

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  async function handlePlay(id: string) {
    setError(null);
    setLaunching(id);
    try {
      await window.noxara.launchInstance(id);
      toast.success("Launching Minecraft");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to launch";
      setError(message);
      toast.error("Could not launch Minecraft", message);
    } finally {
      setLaunching(null);
    }
  }

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-semibold text-noxara-white">
          {greeting}
          {account ? `, ${account.username}` : ""}
        </h1>
        <Link to="/instances" className="yz-btn-secondary hidden sm:inline-flex">
          <Plus size={16} /> New Instance
        </Link>
      </div>

      {error && (
        <div className="mb-6 yz-card border-noxara-error/40 bg-noxara-error/5 px-4 py-3 text-sm text-noxara-error">
          {error}
        </div>
      )}

      {loading ? (
        <div className="yz-skeleton rounded-md h-64 md:h-80 mb-10" />
      ) : featured ? (
        <div className="relative rounded-md overflow-hidden border border-noxara-border mb-10 h-64 md:h-80">
          <InstanceCover name={featured.name} className="absolute inset-0 rounded-none border-0" />
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
          <div className="relative h-full flex flex-col justify-end p-6 md:p-8">
            <div className="text-xs yz-label mb-2 text-noxara-subtle">Featured Instance</div>
            <div className="text-2xl md:text-4xl font-semibold text-noxara-white mb-1">{featured.name}</div>
            <div className="text-sm text-noxara-subtle mb-6">
              Minecraft {featured.minecraftVersion} · {featured.loader === "vanilla" ? "Vanilla" : featured.loader}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => handlePlay(featured.id)}
                disabled={launching === featured.id}
                className="yz-btn-primary px-6"
              >
                <Play size={16} />
                {launching === featured.id ? "Launching…" : "Play"}
              </button>
              <Link to={`/instances/${featured.id}`} className="yz-btn-secondary bg-black/30 backdrop-blur-sm">
                Details
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="yz-card p-10 text-center mb-10">
          <p className="text-sm text-noxara-subtle mb-4">No instances yet.</p>
          <Link to="/instances" className="yz-btn-primary inline-flex">
            Create your first instance
          </Link>
        </div>
      )}

      {recents.length > 0 && (
        <div>
          <div className="text-xs yz-label mb-3">Recently Played</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
            {recents.map((i) => (
              <Link
                key={i.id}
                to={`/instances/${i.id}`}
                className="group rounded-md overflow-hidden border border-noxara-border hover:border-noxara-border-strong transition-colors duration-150"
              >
                <InstanceCover name={i.name} className="w-full aspect-square rounded-none border-0" compact />
                <div className="bg-noxara-surface px-3 py-2">
                  <div className="text-sm font-medium truncate group-hover:text-noxara-white transition-colors">
                    {i.name}
                  </div>
                  <div className="text-xs text-noxara-muted mt-0.5 truncate">{i.minecraftVersion}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
