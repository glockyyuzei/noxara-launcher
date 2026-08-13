import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Boxes, X } from "lucide-react";
import type { InstanceRecord } from "@shared/types/ipc";
import { CreateInstanceWizard } from "../components/CreateInstanceWizard";
import { InstanceCover } from "../components/InstanceCover";
import { InstanceStateBadge } from "../components/InstanceStateBadge";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { launchInstance } from "../stores/useLaunchStore";
import { friendlyErrorMessage } from "../lib/coreErrors";
import { toast } from "../stores/useToastStore";

export default function InstancesPage() {
  const [instances, setInstances] = useState<InstanceRecord[]>([]);
  const [showWizard, setShowWizard] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    setLoading(true);
    window.noxara.listInstances().then((list) => {
      setInstances(list);
      setLoading(false);
    });
  }

  useEffect(refresh, []);

  async function handlePlay(id: string) {
    setError(null);
    try {
      await launchInstance(id);
    } catch (e) {
      const message = friendlyErrorMessage(e);
      setError(message);
      toast.error("Could not launch Minecraft", message);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <PageHeader
        title="Instances"
        actions={
          <button onClick={() => setShowWizard(true)} className="yz-btn-primary">
            <Plus size={16} />
            New Instance
          </button>
        }
      />

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <div className="yz-skeleton aspect-video rounded-md mb-1.5" />
              <div className="yz-skeleton h-3.5 w-3/4 rounded mb-1" />
              <div className="yz-skeleton h-3 w-1/2 rounded" />
            </div>
          ))}
        </div>
      ) : instances.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No Minecraft instances yet"
          description="Create your first instance to get started."
          action={
            <button onClick={() => setShowWizard(true)} className="yz-btn-primary">
              <Plus size={16} /> Create Instance
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2">
          {instances.map((i) => (
            <Link
              key={i.id}
              to={`/instances/${i.id}`}
              className="group rounded-md overflow-hidden border border-noxara-border hover:border-noxara-border-strong hover:-translate-y-0.5 hover:shadow-card-hover transition-all duration-200 bg-noxara-surface yz-focus-ring"
            >
              <div className="relative">
                <InstanceCover loader={i.loader} className="w-full aspect-video rounded-none border-0" compact />
                <span className="absolute top-1.5 right-1.5">
                  <InstanceStateBadge instanceId={i.id} />
                </span>
                {i.favorite && (
                  <span className="absolute top-1.5 left-1.5 text-[9px] font-medium bg-black/70 backdrop-blur-sm text-noxara-white px-1.5 py-0.5 rounded">
                    ★
                  </span>
                )}
              </div>
              <div className="px-2 py-1.5">
                <div className="text-sm font-medium truncate group-hover:text-noxara-white transition-colors">
                  {i.name}
                </div>
                <div className="text-[11px] text-noxara-muted truncate">
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
