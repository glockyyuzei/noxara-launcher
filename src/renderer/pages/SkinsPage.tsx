import { useEffect, useRef, useState } from "react";
import { Upload, Trash2, Pencil, Check, Loader2, Shirt, RotateCcw } from "lucide-react";
import type { SkinRecord, AccountSkinTexture } from "@shared/types/ipc";
import { useAccountStore } from "../stores/useAccountStore";
import { toast } from "../stores/useToastStore";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Alert } from "../components/ui/alert";
import { Separator } from "../components/ui/separator";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import { SkinViewer, type SkinViewerHandle } from "../components/skin-viewer/SkinViewer";
import type { SkinModel, AnimationType } from "../components/skin-viewer/playerModel";
import { cn } from "../lib/utils";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function skinIsLegacy(dataUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalHeight === 32);
    img.onerror = () => resolve(false);
    img.src = dataUrl;
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
  const viewerRef = useRef<SkinViewerHandle | null>(null);

  // Select the active account by value (not via the stable `activeAccount()` helper),
  // so the component re-renders when the account list or active account changes.
  const account = useAccountStore((s) => s.accounts.find((a) => a.isActive) ?? null);
  const [appliedSkinId, setAppliedSkinId] = useState<string | null>(null);
  const [accountTexture, setAccountTexture] = useState<AccountSkinTexture | null>(null);

  // Viewer state. A library skin selected in the grid is "previewed" in the 3D viewer
  // without being applied; deselecting falls back to the account's actual skin.
  const [previewSkin, setPreviewSkin] = useState<SkinRecord | null>(null);
  const [viewerModel, setViewerModel] = useState<SkinModel>("classic");
  const [animEnabled, setAnimEnabled] = useState(true);
  const [animType, setAnimType] = useState<AnimationType>("idle");
  const [legacy, setLegacy] = useState(false);

  const displayedDataUrl = previewSkin?.dataUrl ?? accountTexture?.dataUrl ?? null;
  const isPreviewing = previewSkin !== null;
  const isOffline = account?.kind === "offline";

  async function refresh() {
    const list = await window.noxara.listSkins();
    setSkins(list);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
  }, []);

  async function refreshAccount() {
    if (!account) {
      setAccountTexture(null);
      setAppliedSkinId(null);
      setPreviewSkin(null);
      return;
    }
    const [texture, stored] = await Promise.all([
      window.noxara.getAccountSkinTexture(account.id),
      window.noxara.getAccountSkin(account.id),
    ]);
    setAccountTexture(texture);
    setAppliedSkinId(stored?.id ?? null);
    if (!isPreviewing) setViewerModel(texture?.model ?? "classic");
  }

  useEffect(() => {
    refreshAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account?.id]);

  useEffect(() => {
    if (!displayedDataUrl) {
      setLegacy(false);
      return;
    }
    let cancelled = false;
    skinIsLegacy(displayedDataUrl).then((value) => {
      if (!cancelled) setLegacy(value);
    });
    return () => {
      cancelled = true;
    };
  }, [displayedDataUrl]);

  async function handleUpload(file: File) {
    setUploading(true);
    try {
      const base64 = await fileToBase64(file);
      const skin = await window.noxara.uploadSkin(file.name.replace(/\.png$/i, ""), base64, "classic");
      await refresh();
      setPreviewSkin(skin);
      setViewerModel(skin.model);
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
      await refreshAccount();
      toast.success(
        "Skin applied",
        isOffline
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
    if (previewSkin?.id === id) setPreviewSkin(null);
    toast.success("Skin removed");
  }

  async function handleRename(id: string) {
    if (!renameValue.trim()) return;
    await window.noxara.renameSkin(id, renameValue.trim());
    await refresh();
    setRenamingId(null);
  }

  const currentStatus = isPreviewing
    ? "Previewing — select Apply to use it."
    : accountTexture?.source === "mojang"
      ? "Showing your current Mojang skin."
      : accountTexture
        ? "Showing your selected skin."
        : "No skin on this account — showing the default skin.";

  return (
    <div className="w-full space-y-5 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title="Skins" subtitle="Preview, manage and apply your Minecraft skins." />
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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* 3D viewer */}
        <div className="yz-card overflow-hidden">
          <div className="relative h-[360px] sm:h-[440px] lg:h-[520px] bg-[radial-gradient(circle_at_50%_35%,rgba(255,255,255,0.05),transparent_60%)]">
            <SkinViewer
              ref={viewerRef}
              dataUrl={displayedDataUrl}
              model={viewerModel}
              animationEnabled={animEnabled}
              animationType={animType}
            />
            <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">
                {isPreviewing ? `Preview: ${previewSkin!.name}` : account?.username ?? "Account"}
              </Badge>
              {isPreviewing && !appliedSkinId && <Badge variant="outline">not applied</Badge>}
              {legacy && <Badge variant="outline">legacy 64×32</Badge>}
            </div>
          </div>
          <div className="border-t border-noxara-border px-4 py-3">
            <p className="text-xs text-noxara-subtle">
              <span className="font-medium text-noxara-text">{isPreviewing ? "Previewing" : "Current skin"}</span>
              {" — "}
              {currentStatus}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="yz-card p-4 space-y-5 h-fit">
          <div>
            <h3 className="text-sm font-semibold text-noxara-text mb-2">Model</h3>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-noxara-elevated p-1">
              {(["classic", "slim"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setViewerModel(m)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    viewerModel === m
                      ? "bg-noxara-white text-noxara-black"
                      : "text-noxara-subtle hover:text-noxara-text"
                  )}
                >
                  {m === "classic" ? "Classic" : "Slim"}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-noxara-muted">
              {viewerModel === "classic" ? "4px-wide arms" : "3px-wide arms"}
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-noxara-text mb-2">Animation</h3>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-noxara-elevated p-1">
              {[
                { value: true, label: "On" },
                { value: false, label: "Off" },
              ].map((o) => (
                <button
                  key={String(o.value)}
                  onClick={() => setAnimEnabled(o.value)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                    animEnabled === o.value
                      ? "bg-noxara-white text-noxara-black"
                      : "text-noxara-subtle hover:text-noxara-text"
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {animEnabled && (
              <div className="mt-2 grid grid-cols-2 gap-1 rounded-lg bg-noxara-elevated p-1">
                {(["idle", "walk"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setAnimType(t)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      animType === t
                        ? "bg-noxara-white text-noxara-black"
                        : "text-noxara-subtle hover:text-noxara-text"
                    )}
                  >
                    {t === "idle" ? "Idle" : "Walk"}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Button variant="secondary" size="default" className="w-full" onClick={() => viewerRef.current?.resetView()}>
              <RotateCcw size={14} /> Reset View
            </Button>
            {isPreviewing && (
              <Button
                variant="primary"
                size="default"
                className="w-full"
                disabled={!account || applyingId === previewSkin!.id}
                onClick={() => handleApply(previewSkin!.id)}
              >
                {applyingId === previewSkin!.id ? (
                  <>
                    <Loader2 size={14} className="animate-spin" /> Applying…
                  </>
                ) : (
                  "Apply this skin"
                )}
              </Button>
            )}
          </div>

          {isOffline && (
            <Alert variant="default" title="Offline profile">
              Offline profiles have no Mojang account to upload to, so applying a skin
              stores it on your profile and carries it into the instance on every launch.
              Microsoft accounts get their skin uploaded to Mojang's real skin service —
              visible in any launcher and in vanilla Minecraft.
            </Alert>
          )}
        </div>
      </div>

      <Separator />

      {/* Library */}
      <div>
        <h2 className="text-sm font-semibold text-noxara-text mb-3">My Skins</h2>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="yz-skeleton aspect-[3/4] rounded-md" />
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
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {skins.map((skin) => {
              const isApplied = appliedSkinId === skin.id;
              const isApplying = applyingId === skin.id;
              const isSelected = previewSkin?.id === skin.id;
              return (
                <div
                  key={skin.id}
                  onClick={() => {
                    setPreviewSkin(skin);
                    setViewerModel(skin.model);
                  }}
                  className={cn(
                    "yz-card p-3 cursor-pointer group transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card-hover",
                    isSelected
                      ? "border-noxara-white/60 ring-1 ring-noxara-white/40"
                      : isApplied
                        ? "border-noxara-success/40"
                        : "hover:border-noxara-border-strong"
                  )}
                >
                  <div
                    className="w-full aspect-square rounded bg-noxara-elevated border border-noxara-border mb-2 overflow-hidden flex items-center justify-center relative"
                    style={{ imageRendering: "pixelated" }}
                  >
                    <img src={skin.dataUrl} alt={skin.name} className="w-3/4 h-3/4 object-contain" />
                    {isApplied && !isSelected && (
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
                      onClick={(e) => e.stopPropagation()}
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
                      onClick={(e) => {
                        e.stopPropagation();
                        handleApply(skin.id);
                      }}
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
                    <div
                      className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                      onClick={(e) => e.stopPropagation()}
                    >
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
    </div>
  );
}