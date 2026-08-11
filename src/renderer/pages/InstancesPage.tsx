import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Play, Boxes } from "lucide-react";
import type { InstanceRecord } from "@shared/types/ipc";
import { CreateInstanceWizard } from "../components/CreateInstanceWizard";
import { InstanceCover } from "../components/InstanceCover";
import { useLaunchStore } from "../stores/useLaunchStore";

export default function InstancesPage() {
  const [instances, setInstances] = useState<InstanceRecord[]>([]);
  const [showWizard, setShowWizard] = useState(false);
  const [loading, setLoading] = useState(true);
  const runningIds = useLaunchStore((s) => s.runningInstanceIds);

  function refresh() {
    setLoading(true);
    window.noxara.listInstances().then((list) => {
      setInstances(list);
      setLoading(false);
    });
  }

  useEffect(refresh, []);

  return (
    <div className="p-6 md:p-10 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6 md:mb-8">
        <h1 className="text-xl md:text-2xl font-semibold text-noxara-white">Instances</h1>
        <button onClick={() => setShowWizard(true)} className="yz-btn-primary">
          <Plus size={16} />
          New Instance
        </button>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <div className="yz-skeleton aspect-[4/3] rounded-md mb-2" />
              <div className="yz-skeleton h-3.5 w-3/4 rounded mb-1.5" />
              <div className="yz-skeleton h-3 w-1/2 rounded" />
            </div>
          ))}
        </div>
      ) : instances.length === 0 ? (
        <div className="yz-card p-10 flex flex-col items-center text-center">
          <div className="w-12 h-12 rounded-full bg-noxara-elevated flex items-center justify-center mb-4">
            <Boxes size={22} className="text-noxara-muted" />
          </div>
          <p className="text-sm text-noxara-text font-medium mb-1">No Minecraft instances yet</p>
          <p className="text-sm text-noxara-muted mb-5">Create your first instance to get started.</p>
          <button onClick={() => setShowWizard(true)} className="yz-btn-primary">
            <Plus size={16} /> Create Instance
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4">
          {instances.map((i) => (
            <Link
              key={i.id}
              to={`/instances/${i.id}`}
              className="group rounded-md overflow-hidden border border-noxara-border hover:border-noxara-border-strong hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/30 transition-all duration-200 bg-noxara-surface yz-focus-ring"
            >
              <div className="relative">
                <InstanceCover name={i.name} className="w-full aspect-[4/3] rounded-none border-0" />
                {runningIds.has(i.id) && (
                  <span className="absolute top-2 right-2 flex items-center gap-1 text-[10px] font-medium bg-black/70 backdrop-blur-sm text-noxara-success px-2 py-1 rounded">
                    <Play size={9} fill="currentColor" /> RUNNING
                  </span>
                )}
                {i.favorite && (
                  <span className="absolute top-2 left-2 text-[10px] font-medium bg-black/70 backdrop-blur-sm text-noxara-white px-2 py-1 rounded">
                    ★
                  </span>
                )}
              </div>
              <div className="px-3 py-2.5">
                <div className="text-sm font-medium truncate group-hover:text-noxara-white transition-colors">
                  {i.name}
                </div>
                <div className="text-xs text-noxara-muted mt-0.5 truncate">
                  {i.minecraftVersion} · {i.loader === "vanilla" ? "Vanilla" : i.loader}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showWizard && (
        <CreateInstanceWizard
          onClose={() => setShowWizard(false)}
          onCreated={() => {
            setShowWizard(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
