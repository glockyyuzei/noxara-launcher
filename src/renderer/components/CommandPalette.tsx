import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X, Boxes, Home, Settings, UserRound, Coffee, Server, Puzzle, Package, Image, Sparkles, Download } from "lucide-react";
import type { AccountRecord, InstanceRecord, ServerRecord } from "@shared/types/ipc";
import { loaderDisplayName } from "../lib/loaders";

const PAGES = [
  { to: "/", label: "Home", icon: Home },
  { to: "/instances", label: "Instances", icon: Boxes },
  { to: "/mods", label: "Browse Mods", icon: Puzzle },
  { to: "/modpacks", label: "Modpacks", icon: Package },
  { to: "/resourcepacks", label: "Resource Packs", icon: Image },
  { to: "/shaders", label: "Shaders", icon: Sparkles },
  { to: "/servers", label: "Servers", icon: Server },
  { to: "/accounts", label: "Accounts", icon: UserRound },
  { to: "/java", label: "Java", icon: Coffee },
  { to: "/downloads", label: "Downloads", icon: Download },
  { to: "/settings", label: "Settings", icon: Settings },
] as const;

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [instances, setInstances] = useState<InstanceRecord[]>([]);
  const [accounts, setAccounts] = useState<AccountRecord[]>([]);
  const [servers, setServers] = useState<ServerRecord[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    inputRef.current?.focus();
    // Fresh data each time the palette opens so results reflect real current state.
    window.noxara.listInstances().then(setInstances).catch(() => setInstances([]));
    window.noxara.listAccounts().then(setAccounts).catch(() => setAccounts([]));
    window.noxara.listServers(null).then(setServers).catch(() => setServers([]));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (s: string) => !q || s.toLowerCase().includes(q);
    const pages = PAGES.filter((p) => match(p.label));
    const instanceResults = instances
      .filter((i) => match(i.name) || match(i.minecraftVersion) || match(i.loader))
      .slice(0, 6)
      .map((i) => ({
        key: `instance:${i.id}`,
        icon: Boxes,
        title: i.name,
        subtitle: `Minecraft ${i.minecraftVersion} · ${loaderDisplayName(i.loader)}`,
        action: () => navigate(`/instances/${i.id}`),
      }));
    const accountResults = accounts
      .filter((a) => match(a.username) || match(a.kind))
      .slice(0, 4)
      .map((a) => ({
        key: `account:${a.id}`,
        icon: UserRound,
        title: a.username,
        subtitle: a.kind === "microsoft" ? "Microsoft account" : "Offline profile",
        action: () => {
          onClose();
          navigate("/accounts");
        },
      }));
    const serverResults = servers
      .filter((s) => match(s.name) || match(s.address))
      .slice(0, 4)
      .map((s) => ({
        key: `server:${s.id}`,
        icon: Server,
        title: s.name,
        subtitle: s.address,
        action: () => {
          onClose();
          navigate("/servers");
        },
      }));
    return [
      ...pages.map((p) => ({
        key: `page:${p.to}`,
        icon: p.icon,
        title: p.label,
        subtitle: "Page",
        action: () => {
          onClose();
          navigate(p.to);
        },
      })),
      ...instanceResults,
      ...accountResults,
      ...serverResults,
    ].slice(0, 20);
  }, [query, instances, accounts, servers, navigate, onClose]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, results.length]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-start justify-center pt-[15vh] p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="yz-card w-full max-w-lg overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-noxara-border">
          <Search size={15} className="text-noxara-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIndex((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                const r = results[activeIndex];
                if (r) r.action();
              }
            }}
            placeholder="Search instances, pages, accounts, servers…"
            className="flex-1 bg-transparent outline-none text-sm text-noxara-text placeholder:text-noxara-muted"
          />
          <button onClick={onClose} className="text-noxara-muted hover:text-noxara-text" aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto py-1.5">
          {results.length === 0 ? (
            <div className="px-4 py-6 text-sm text-noxara-muted text-center">No matches found.</div>
          ) : (
            results.map((r, idx) => {
              const Icon = r.icon;
              return (
                <button
                  key={r.key}
                  onClick={r.action}
                  onMouseEnter={() => setActiveIndex(idx)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                    idx === activeIndex ? "bg-noxara-elevated" : ""
                  }`}
                >
                  <Icon size={15} className="text-noxara-subtle shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm text-noxara-text truncate">{r.title}</div>
                    <div className="text-xs text-noxara-muted truncate">{r.subtitle}</div>
                  </div>
                </button>
              );
            })
          )}
        </div>
        <div className="px-4 py-2 border-t border-noxara-border text-[11px] text-noxara-muted flex items-center gap-3">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}