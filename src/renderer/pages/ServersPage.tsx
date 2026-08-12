import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Star, Copy, Pencil, Trash2, Server, Play, X, Check, ImageUp, Wifi, WifiOff } from "lucide-react";
import type { InstanceRecord, ServerPingResult, ServerRecord } from "@shared/types/ipc";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { toast } from "../stores/useToastStore";
import { launchInstance, useLaunchStore } from "../stores/useLaunchStore";

type EditorState = { mode: "add" } | { mode: "edit"; server: ServerRecord } | null;

const OFFLINE_RESULT: ServerPingResult = {
  online: false,
  latencyMs: null,
  versionName: null,
  protocol: null,
  playersOnline: null,
  playersMax: null,
  description: null,
  favicon: null,
};

export default function ServersPage() {
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [instances, setInstances] = useState<InstanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "global" | "scoped">("all");
  const [editor, setEditor] = useState<EditorState>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [statusById, setStatusById] = useState<Record<string, ServerPingResult>>({});
  const navigate = useNavigate();

  const runningIds = useLaunchStore((s) => s.runningInstanceIds);

  async function refresh() {
    const list = await window.noxara.listServers();
    setServers(list);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    window.noxara.listInstances().then(setInstances);
  }, []);

  // Probes every visible server with the MC server list ping and refreshes on an
  // interval so player counts stay live while the page is open.
  useEffect(() => {
    if (servers.length === 0) {
      setStatusById({});
      return;
    }
    let cancelled = false;
    async function pingAll() {
      const next: Record<string, ServerPingResult> = {};
      await Promise.all(
        servers.map(async (s) => {
          try {
            next[s.id] = await window.noxara.pingServer(s.address, s.port);
          } catch {
            next[s.id] = OFFLINE_RESULT;
          }
        })
      );
      if (!cancelled) setStatusById((prev) => ({ ...prev, ...next }));
    }
    pingAll();
    const timer = setInterval(pingAll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [servers]);

  const visible = useMemo(
    () =>
      servers.filter((s) =>
        filter === "all" ? true : filter === "global" ? s.instanceId === null : s.instanceId !== null
      ),
    [servers, filter]
  );

  async function toggleFavorite(server: ServerRecord) {
    await window.noxara.updateServer(server.id, { favorite: !server.favorite });
    await refresh();
  }

  async function handleRemove(server: ServerRecord) {
    try {
      await window.noxara.removeServer(server.id);
      await refresh();
      toast.success("Server removed", server.name);
    } catch (e) {
      toast.error("Couldn't remove server", e instanceof Error ? e.message : undefined);
    }
  }

  async function copyAddress(server: ServerRecord) {
    const value = `${server.address}${server.port !== 25565 ? `:${server.port}` : ""}`;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(server.id);
      setTimeout(() => setCopiedId((id) => (id === server.id ? null : id)), 1200);
    } catch {
      toast.error("Couldn't copy address");
    }
  }

  async function handlePlay(server: ServerRecord) {
    if (!server.instanceId) {
      toast.error("No instance linked", "Edit this server and pick an instance to play.");
      return;
    }
    // Minecraft's own fixed args: --server <ip> --port <port>. Port 25565 is the
    // default and can be omitted. These are appended as game args, so the game
    // launches straight into this server instead of just the linked instance.
    const gameArgs =
      server.port === 25565
        ? ["--server", server.address]
        : ["--server", server.address, "--port", String(server.port)];
    try {
      await launchInstance(server.instanceId, gameArgs);
      navigate(`/instances/${server.instanceId}`);
    } catch (e) {
      toast.error("Couldn't launch Minecraft", e instanceof Error ? e.message : undefined);
    }
  }

  const instanceName = (id: string | null) =>
    id ? instances.find((i) => i.id === id)?.name ?? "Unknown instance" : "All instances";

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <PageHeader
        title="Servers"
        subtitle="Manage multiplayer servers for your instances."
        actions={
          <button onClick={() => setEditor({ mode: "add" })} className="yz-btn-primary">
            <Plus size={16} /> Add Server
          </button>
        }
      />

      <div className="flex gap-1 mb-5">
        {(["all", "global", "scoped"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded text-xs font-medium capitalize transition-colors duration-150 yz-focus-ring ${
              filter === f
                ? "bg-noxara-elevated text-noxara-white border border-noxara-border-strong"
                : "text-noxara-muted hover:text-noxara-text hover:bg-noxara-surface border border-transparent"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="yz-skeleton h-16 rounded-md" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No servers here"
          description={
            servers.length === 0
              ? "Add a server to keep your multiplayer worlds one click away."
              : "Try a different filter, or add a new server."
          }
          action={
            <button onClick={() => setEditor({ mode: "add" })} className="yz-btn-secondary text-xs">
              <Plus size={14} /> Add Server
            </button>
          }
        />
      ) : (
        <div className="space-y-1.5">
          {visible.map((server) => {
            const running = server.instanceId ? runningIds.has(server.instanceId) : false;
            return (
              <div key={server.id} className="yz-card px-3.5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-3">
                  <button
                    onClick={() => toggleFavorite(server)}
                    aria-label={server.favorite ? "Unfavorite" : "Favorite"}
                    className={`shrink-0 transition-colors ${
                      server.favorite ? "text-noxara-white" : "text-noxara-muted hover:text-noxara-text"
                    }`}
                  >
                    <Star size={15} fill={server.favorite ? "currentColor" : "none"} />
                  </button>
                  <div className="min-w-0">
                    <div className="text-sm text-noxara-text truncate">{server.name}</div>
                    <div className="text-xs text-noxara-muted font-mono truncate">
                      {server.address}
                      {server.port !== 25565 ? `:${server.port}` : ""}
                    </div>
                  </div>
                  <span className="hidden sm:inline-flex text-[10px] px-2 py-0.5 rounded-full bg-noxara-elevated border border-noxara-border text-noxara-subtle capitalize shrink-0">
                    {instanceName(server.instanceId)}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {running && (
                    <span className="flex items-center gap-1 text-[10px] font-medium text-noxara-success mr-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-noxara-success animate-pulse" /> RUNNING
                    </span>
                  )}
                  <button
                    onClick={() => handlePlay(server)}
                    disabled={!server.instanceId}
                    className="yz-btn-secondary text-xs px-2.5 py-1 disabled:opacity-30"
                    title={server.instanceId ? "Launch the linked instance" : "Link an instance to play"}
                  >
                    <Play size={12} /> Play
                  </button>
                  <button
                    onClick={() => copyAddress(server)}
                    className="text-noxara-muted hover:text-noxara-text p-1.5 transition-colors"
                    aria-label="Copy address"
                    title="Copy address"
                  >
                    {copiedId === server.id ? <Check size={14} className="text-noxara-success" /> : <Copy size={14} />}
                  </button>
                  <button
                    onClick={() => setEditor({ mode: "edit", server })}
                    className="text-noxara-muted hover:text-noxara-text p-1.5 transition-colors"
                    aria-label="Edit"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleRemove(server)}
                    className="text-noxara-muted hover:text-noxara-error p-1.5 transition-colors"
                    aria-label="Delete"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editor && (
        <ServerEditor
          instances={instances}
          initial={editor.mode === "edit" ? editor.server : undefined}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

function ServerEditor({
  instances,
  initial,
  onClose,
  onSaved,
}: {
  instances: InstanceRecord[];
  initial?: ServerRecord;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [port, setPort] = useState(String(initial?.port ?? 25565));
  const [instanceId, setInstanceId] = useState<string>(initial?.instanceId ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const parsedPort = port.trim() === "" ? undefined : Number(port);
      if (initial) {
        await window.noxara.updateServer(initial.id, {
          name,
          address,
          port: parsedPort,
          instanceId: instanceId === "" ? null : instanceId,
        });
      } else {
        await window.noxara.addServer({
          name,
          address,
          port: parsedPort,
          instanceId: instanceId === "" ? null : instanceId,
        });
      }
      toast.success(initial ? "Server updated" : "Server added", name || "Minecraft server");
      await onSaved();
    } catch (e) {
      toast.error("Couldn't save server", e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8 animate-fade-in">
      <div className="yz-card w-full max-w-md p-6 animate-modal-in">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-noxara-text">
            {initial ? "Edit Server" : "Add Server"}
          </h2>
          <button onClick={onClose} className="text-noxara-muted hover:text-noxara-text transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="yz-label block mb-1.5">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Hypixel"
              className="yz-input w-full"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="yz-label block mb-1.5">Address</label>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="mc.hypixel.net"
                className="yz-input w-full font-mono text-xs"
              />
            </div>
            <div>
              <label className="yz-label block mb-1.5">Port</label>
              <input
                value={port}
                onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="25565"
                className="yz-input w-full font-mono text-xs"
              />
            </div>
          </div>
          <div>
            <label className="yz-label block mb-1.5">Instance</label>
            <select
              value={instanceId}
              onChange={(e) => setInstanceId(e.target.value)}
              className="yz-select w-full"
            >
              <option value="">All instances</option>
              {instances.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} ({i.minecraftVersion} · {i.loader === "vanilla" ? "Vanilla" : i.loader})
                </option>
              ))}
            </select>
            <p className="text-xs text-noxara-muted mt-1.5">
              Linking a server to an instance lets you launch straight into it from here.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="yz-btn-ghost">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || !address.trim()} className="yz-btn-primary disabled:opacity-40">
            {saving ? "Saving…" : initial ? "Save" : "Add Server"}
          </button>
        </div>
      </div>
    </div>
  );
}
