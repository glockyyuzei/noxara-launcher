import { useEffect, useRef, useState } from "react";
import { Upload, Trash2, Pencil, Check, Loader2, Shirt } from "lucide-react";
import type { SkinRecord } from "@shared/types/ipc";
import { useAccountStore } from "../stores/useAccountStore";
import { toast } from "../stores/useToastStore";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Alert } from "../components/ui/alert";
import { Separator } from "../components/ui/separator";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function SkinsPage() {
  const [skins, setSkins] = useState<SkinRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Select the active account by value (not via the stable `activeAccount()` helper),
  // so the component re-renders when the account list or active account changes.
  const account = useAccountStore((s) => s.accounts.find((a) => a.isActive) ?? null);
  const [appliedSkinId, setAppliedSkinId] = useState<string | null>(null);

  async function refresh() {
    const list = await window.noxara.listSkins();
    setSkins(list);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (!account) return;
    window.noxara.getAccountSkin(account.id).then((skin) => setAppliedSkinId(skin?.id ?? null));
  }, [account?.id]);

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const base64 = await fileToBase64(file);
      const skin = await window.noxara.uploadSkin(file.name.replace(/\.png$/i, ""), base64, "classic");
      await refresh();
      toast.success("Skin uploaded", skin.name);
    } catch (e) {
      toast.error("Invalid skin", e instanceof Error ? e.message : undefined);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleApply(skinId: string) {
    if (!account) {
      toast.error("No account selected", "Select an account first.");
      return;
    }
    setApplyingId(skinId);
    try {
      // This calls all the way through to Mojang's real skin service for Microsoft
      // accounts — the UI only shows "Applied" after that succeeds, never before.
      // For offline accounts the selection is persisted locally and carried into the
      // instance's game directory on every launch (see skins.ts / launch.ts).
      await window.noxara.applySkin(account.id, skinId);
      setAppliedSkinId(skinId);
      toast.success(
        "Skin applied",
        account.kind === "offline"
          ? "Saved to your offline profile — it accompanies your launches."
          : "Your in-game skin has been updated."
      );
    } catch (e) {
      toast.error("Couldn't apply skin", e instanceof Error ? e.message : undefined);
    } finally {
      setApplyingId(null);
    }
  }

  async function handleDelete(id: string) {
    await window.noxara.deleteSkin(id);
    await refresh();
    if (appliedSkinId === id) setAppliedSkinId(null);
    toast.success("Skin removed");
  }

  async function handleRename(id: string) {
    if (!renameValue.trim()) return;
    await window.noxara.renameSkin(id, renameValue.trim());
    await refresh();
    setRenamingId(null);
  }

  const isOffline = account?.kind === "offline";

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <PageHeader title="Skins" subtitle="Manage and apply your Minecraft skins." />

      {isOffline && (
        <Alert variant="default" title="Offline profile" className="mb-6">
          Offline profiles have no Mojang account to upload a skin to, so applying one
          stores it on your profile and carries it into the instance on every launch —
          as <span className="font-mono">noxara-skin.png</span> in the game directory and
          as a CustomSkinLoader local skin, so supported skins actually render in-game.
          Microsoft accounts get their skin uploaded to Mojang's real skin service
          instead — visible in any launcher and in vanilla Minecraft.
        </Alert>
      )}

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-noxara-text">My Skins</h2>
        <Button
          variant="primary"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          <Upload size={14} /> {uploading ? "Uploading…" : "Upload Skin"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
        />
      </div>

      <Separator className="mb-5" />

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="yz-skeleton aspect-square rounded-md" />
          ))}
        </div>
      ) : skins.length === 0 ? (
        <EmptyState
          icon={Shirt}
          title="No skins yet"
          description="Upload a skin to store, preview, and apply it."
          action={
            <Button
              variant="primary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="mx-auto"
            >
              <Upload size={14} /> Upload Skin
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {skins.map((skin) => {
            const isApplied = appliedSkinId === skin.id;
            const isApplying = applyingId === skin.id;
            return (
              <div
                key={skin.id}
                className={`yz-card p-3 group transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover ${
                  isApplied ? "border-noxara-success/40" : "hover:border-noxara-border-strong"
                }`}
              >
                <div
                  className="w-full aspect-square rounded bg-noxara-elevated border border-noxara-border mb-2 overflow-hidden flex items-center justify-center relative"
                  style={{ imageRendering: "pixelated" }}
                >
                  <img src={skin.dataUrl} alt={skin.name} className="w-3/4 h-3/4 object-contain" />
                  {isApplied && (
                    <Badge variant="success" className="absolute top-1.5 right-1.5">
                      <Check size={10} /> Applied
                    </Badge>
                  )}
                </div>

                {renamingId === skin.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => handleRename(skin.id)}
                    onKeyDown={(e) => e.key === "Enter" && handleRename(skin.id)}
                    className="yz-input w-full text-xs py-1 mb-1.5"
                  />
                ) : (
                  <p className="text-xs text-noxara-text truncate mb-1.5">{skin.name}</p>
                )}

                <div className="flex items-center justify-between gap-1.5">
                  <Button
                    variant={isApplied ? "secondary" : "primary"}
                    size="sm"
                    className="flex-1 text-[11px] py-1"
                    disabled={isApplied || isApplying}
                    onClick={() => handleApply(skin.id)}
                  >
                    {isApplying ? (
                      <>
                        <Loader2 size={11} className="animate-spin" /> Applying…
                      </>
                    ) : isApplied ? (
                      "Applied"
                    ) : (
                      "Apply"
                    )}
                  </Button>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                    <button
                      onClick={() => {
                        setRenamingId(skin.id);
                        setRenameValue(skin.name);
                      }}
                      aria-label="Rename"
                      className="text-noxara-muted hover:text-noxara-text p-1.5"
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      onClick={() => handleDelete(skin.id)}
                      aria-label="Delete"
                      className="text-noxara-muted hover:text-noxara-error p-1.5"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
