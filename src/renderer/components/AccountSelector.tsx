import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronUp, Plus, Settings, Check } from "lucide-react";
import { useAccountStore } from "../stores/useAccountStore";
import { AccountAvatar } from "./AccountAvatar";
import { toast } from "../stores/useToastStore";

function kindLabel(kind: "microsoft" | "offline") {
  return kind === "microsoft" ? "Microsoft Account" : "Offline Account";
}

export function AccountSelector({ collapsed }: { collapsed: boolean }) {
  const { accounts, loading, hasLoaded, refresh, switchAccount } = useAccountStore();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!hasLoaded) refresh();
  }, [hasLoaded, refresh]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  const active = accounts.find((a) => a.isActive) ?? null;

  async function handleSwitch(id: string, username: string) {
    if (id === active?.id) {
      setOpen(false);
      return;
    }
    try {
      await switchAccount(id);
      toast.success("Account switched", `Now playing as ${username}`);
    } catch (e) {
      toast.error("Couldn't switch account", e instanceof Error ? e.message : undefined);
    }
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 mb-2 w-64 yz-card p-1.5 shadow-xl shadow-black/50 animate-dropdown-in z-50 origin-bottom-left"
        >
          <div className="px-2.5 py-1.5 yz-label">Accounts</div>

          {loading && !hasLoaded ? (
            <div className="space-y-1.5 p-1.5">
              <div className="yz-skeleton h-10 rounded" />
              <div className="yz-skeleton h-10 rounded" />
            </div>
          ) : accounts.length === 0 ? (
            <div className="px-2.5 py-3 text-xs text-noxara-muted">No accounts yet.</div>
          ) : (
            <div className="max-h-64 overflow-y-auto space-y-0.5">
              {accounts.map((a) => (
                <button
                  key={a.id}
                  role="menuitemradio"
                  aria-checked={a.isActive}
                  onClick={() => handleSwitch(a.id, a.username)}
                  className={`w-full flex items-center gap-2.5 rounded px-2 py-2 text-left transition-colors duration-150 yz-focus-ring ${
                    a.isActive ? "bg-noxara-elevated" : "hover:bg-noxara-surface"
                  }`}
                >
                  <AccountAvatar account={a} size={28} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate text-noxara-text">{a.username}</div>
                    <div className="text-xs text-noxara-muted truncate">{kindLabel(a.kind)}</div>
                  </div>
                  {a.isActive && <Check size={15} className="text-noxara-success shrink-0" />}
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-noxara-border mt-1.5 pt-1.5 space-y-0.5">
            <button
              onClick={() => {
                setOpen(false);
                navigate("/accounts");
              }}
              className="w-full flex items-center gap-2.5 rounded px-2.5 py-2 text-sm text-noxara-subtle hover:text-noxara-text hover:bg-noxara-surface transition-colors duration-150 yz-focus-ring"
            >
              <Plus size={15} /> Add Account
            </button>
            <button
              onClick={() => {
                setOpen(false);
                navigate("/accounts");
              }}
              className="w-full flex items-center gap-2.5 rounded px-2.5 py-2 text-sm text-noxara-subtle hover:text-noxara-text hover:bg-noxara-surface transition-colors duration-150 yz-focus-ring"
            >
              <Settings size={15} /> Manage Accounts
            </button>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 rounded px-2 py-2 hover:bg-noxara-surface transition-colors duration-150 yz-focus-ring"
      >
        {!hasLoaded ? (
          <>
            <div className="yz-skeleton w-8 h-8 rounded shrink-0" />
            {!collapsed && <div className="yz-skeleton h-8 flex-1 rounded" />}
          </>
        ) : (
          <>
            <AccountAvatar account={active} size={32} />
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1 text-left">
                  <div className="text-sm truncate text-noxara-text">
                    {active ? active.username : "No account"}
                  </div>
                  <div className="text-xs text-noxara-muted truncate">
                    {active ? kindLabel(active.kind) : "Add an account"}
                  </div>
                </div>
                <ChevronUp
                  size={15}
                  className={`text-noxara-muted shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
                />
              </>
            )}
          </>
        )}
      </button>
    </div>
  );
}
