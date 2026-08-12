import { useEffect, useState } from "react";
import { Plus, Trash2, Check, Users, RefreshCw } from "lucide-react";
import { useAccountStore } from "../stores/useAccountStore";
import { AccountAvatar } from "../components/AccountAvatar";
import { MicrosoftLoginModal } from "../components/MicrosoftLoginModal";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { toast } from "../stores/useToastStore";
import type { AccountRecord } from "@shared/types/ipc";

export default function AccountsPage() {
  const { accounts, loading, hasLoaded, refresh, switchAccount, createOffline, refreshProfile, remove } = useAccountStore();
  const [showAdd, setShowAdd] = useState(false);
  const [showMicrosoftLogin, setShowMicrosoftLogin] = useState(false);
  const [offlineUsername, setOfflineUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  useEffect(() => {
    if (!hasLoaded) refresh();
  }, [hasLoaded, refresh]);

  async function handleCreateOffline() {
    setError(null);
    setSubmitting(true);
    try {
      const account = await createOffline(offlineUsername);
      setOfflineUsername("");
      setShowAdd(false);
      toast.success("Account created", `${account.username} is ready to use`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create profile");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSwitch(id: string, username: string) {
    try {
      await switchAccount(id);
      toast.success("Account switched", `Now playing as ${username}`);
    } catch (e) {
      toast.error("Couldn't switch account", e instanceof Error ? e.message : undefined);
    }
  }

  async function handleRemove(id: string, username: string) {
    try {
      await remove(id);
      toast.success("Account removed", `${username} was removed`);
    } catch (e) {
      toast.error("Couldn't remove account", e instanceof Error ? e.message : undefined);
    } finally {
      setPendingRemoveId(null);
    }
  }

  async function handleRefreshProfile(id: string) {
    setRefreshingId(id);
    try {
      await refreshProfile(id);
      toast.success("Profile refreshed", "Your Minecraft profile information is up to date");
    } catch (e) {
      toast.error("Couldn't refresh profile", e instanceof Error ? e.message : undefined);
    } finally {
      setRefreshingId(null);
    }
  }

  function handleMicrosoftLoginSuccess(account: AccountRecord) {
    setShowMicrosoftLogin(false);
    setShowAdd(false);
    refresh();
    toast.success("Account added", `Signed in as ${account.username}`);
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <PageHeader
        title="Accounts"
        subtitle="Manage who you play as."
        actions={
          <button onClick={() => setShowAdd(true)} className="yz-btn-primary">
            <Plus size={16} /> Add Account
          </button>
        }
      />

      {loading && !hasLoaded ? (
        <div className="space-y-2">
          <div className="yz-skeleton h-16 rounded-md" />
          <div className="yz-skeleton h-16 rounded-md" />
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No accounts yet"
          description="Add an account to start playing Minecraft."
          action={
            <button onClick={() => setShowAdd(true)} className="yz-btn-primary">
              <Plus size={16} /> Add Account
            </button>
          }
        />
      ) : (
        <div className="space-y-2">
          {accounts.map((a) => (
            <div
              key={a.id}
              className={`yz-card px-4 py-3 flex items-center justify-between transition-colors duration-150 ${
                a.isActive ? "border-noxara-success/30" : "hover:border-noxara-border-strong"
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <AccountAvatar
                  account={a}
                  size={36}
                  onError={a.kind === "microsoft" ? () => handleRefreshProfile(a.id) : undefined}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{a.username}</div>
                  <div className="text-xs text-noxara-muted truncate">
                    {a.kind === "microsoft" ? "Microsoft Account" : "Offline Account"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {a.kind === "microsoft" && (
                  <button
                    onClick={() => handleRefreshProfile(a.id)}
                    disabled={refreshingId === a.id}
                    aria-label={`Refresh ${a.username} profile`}
                    className="yz-btn-ghost px-2"
                  >
                    <RefreshCw size={15} className={refreshingId === a.id ? "animate-spin" : ""} />
                  </button>
                )}
                {a.isActive ? (
                  <span className="text-xs text-noxara-success px-2 py-1 flex items-center gap-1 font-medium">
                    <Check size={13} /> ACTIVE
                  </span>
                ) : (
                  <button
                    onClick={() => handleSwitch(a.id, a.username)}
                    className="yz-btn-secondary text-xs px-3 py-1.5"
                  >
                    Switch
                  </button>
                )}
                <button
                  onClick={() => setPendingRemoveId(a.id)}
                  aria-label={`Remove ${a.username}`}
                  className="yz-btn-ghost px-2"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showAdd && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8 animate-fade-in"
          onKeyDown={(e) => e.key === "Escape" && setShowAdd(false)}
        >
          <div className="yz-card w-full max-w-sm p-6 animate-modal-in">
            <h2 className="text-sm font-semibold mb-4">Add Account</h2>

            <button
              onClick={() => setShowMicrosoftLogin(true)}
              className="yz-btn-secondary w-full mb-3"
            >
              Login with Microsoft
            </button>
            <p className="text-xs text-noxara-muted mb-5">
              Requires Noxara Labs to have configured a real Azure AD client ID
              (<code>NOXARA_MSA_CLIENT_ID</code>) — if it's missing you'll see a clear error
              instead of a silent failure.
            </p>

            <div className="border-t border-noxara-border pt-4">
              <label className="yz-label block mb-2" htmlFor="offline-username">
                Offline Account Username
              </label>
              <input
                id="offline-username"
                value={offlineUsername}
                onChange={(e) => setOfflineUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateOffline()}
                placeholder="Glocky"
                autoFocus
                className="yz-input w-full mb-2"
              />
              <p className="text-xs text-noxara-muted mb-4">
                Offline accounts are local-only and won't work on servers that require a verified
                Minecraft account.
              </p>
              {error && <p className="text-sm text-noxara-error mb-3">{error}</p>}
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowAdd(false)} className="yz-btn-ghost">
                  Cancel
                </button>
                <button
                  onClick={handleCreateOffline}
                  disabled={submitting || offlineUsername.trim().length === 0}
                  className="yz-btn-primary"
                >
                  {submitting ? "Creating…" : "Create Offline Account"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showMicrosoftLogin && (
        <MicrosoftLoginModal
          onClose={() => setShowMicrosoftLogin(false)}
          onSuccess={handleMicrosoftLoginSuccess}
        />
      )}

      {pendingRemoveId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8 animate-fade-in">
          <div className="yz-card w-full max-w-sm p-6 animate-modal-in">
            <h2 className="text-sm font-semibold mb-2">Remove account?</h2>
            <p className="text-sm text-noxara-muted mb-5">
              {accounts.find((a) => a.id === pendingRemoveId)?.username} will be removed from this
              launcher. This can't be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setPendingRemoveId(null)} className="yz-btn-ghost">
                Cancel
              </button>
              <button
                onClick={() => {
                  const a = accounts.find((acc) => acc.id === pendingRemoveId);
                  if (a) handleRemove(a.id, a.username);
                }}
                className="yz-btn-danger"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
