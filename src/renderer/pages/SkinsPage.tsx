import { useEffect, useRef, useState } from "react";
import { Upload, Trash2, Pencil, Info } from "lucide-react";
import type { SkinRecord } from "@shared/types/ipc";
import { useAccountStore } from "../stores/useAccountStore";
import { toast } from "../stores/useToastStore";

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
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeAccount = useAccountStore((s) => s.activeAccount);
  const account = activeAccount();
  const [selectedSkinId, setSelectedSkinId] = useState<string | null>(null);

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
    window.noxara.getAccountSkin(account.id).then((skin) => setSelectedSkinId(skin?.id ?? null));
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

  async function handleSelect(skinId: string) {
    if (!account) {
      toast.error("No account selected", "Select an account first.");
      return;
    }
    await window.noxara.setAccountSkin(account.id, skinId);
    setSelectedSkinId(skinId);
    toast.success("Skin selected", "See the note below about in-game visibility.");
  }

  async function handleDelete(id: string) {
    await window.noxara.deleteSkin(id);
    await refresh();
    toast.success("Skin removed");
  }

  async function handleRename(id: string) {
    if (!renameValue.trim()) return;
    await window.noxara.renameSkin(id, renameValue.trim());
    await refresh();
    setRenamingId(null);
  }

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl md:text-2xl font-semibold text-noxara-white">Skins</h1>
        <p className="text-sm text-noxara-muted mt-1">Manage local Minecraft skin files.</p>
      </div>

      <div className="yz-card p-4 mb-6 flex gap-3 items-start border-noxara-border-strong">
        <Info size={16} className="text-noxara-subtle shrink-0 mt-0.5" />
        <p className="text-xs text-noxara-muted leading-relaxed">
          Selecting a skin here saves it as your preference in the launcher. Vanilla Minecraft loads
          skins from Mojang's authenticated skin service, and this launcher doesn't patch or spoof
          that — so a selected skin here won't currently appear on your in-game player model for
          offline accounts. This library is genuinely for storing, previewing, and organizing skin
          files today, ready to wire up to the real Mojang skin API once Microsoft account support
          is enabled.
        </p>
      </div>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-noxara-text">My Skins</h2>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="yz-btn-primary text-xs px-3 py-1.5"
        >
          <Upload size={14} /> {uploading ? "Uploading…" : "Upload Skin"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])}
        />
      </div>

      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="yz-skeleton aspect-square rounded-md" />
          ))}
        </div>
      ) : skins.length === 0 ? (
        <div className="yz-card p-10 text-center">
          <p className="text-sm text-noxara-muted mb-4">You haven't saved any skins yet.</p>
          <button onClick={() => fileInputRef.current?.click()} className="yz-btn-primary inline-flex text-xs px-3 py-1.5">
            <Upload size={14} /> Upload Skin
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {skins.map((skin) => (
            <div
              key={skin.id}
              className={`yz-card p-3 group transition-all duration-200 ${
                selectedSkinId === skin.id ? "border-noxara-success/40" : "hover:border-noxara-border-strong"
              }`}
            >
              <button
                onClick={() => handleSelect(skin.id)}
                className="w-full aspect-square rounded bg-noxara-elevated border border-noxara-border mb-2 overflow-hidden flex items-center justify-center yz-focus-ring"
                style={{ imageRendering: "pixelated" }}
              >
                <img src={skin.dataUrl} alt={skin.name} className="w-3/4 h-3/4 object-contain" />
              </button>

              {renamingId === skin.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => handleRename(skin.id)}
                  onKeyDown={(e) => e.key === "Enter" && handleRename(skin.id)}
                  className="yz-input w-full text-xs py-1"
                />
              ) : (
                <p className="text-xs text-noxara-text truncate mb-1.5">{skin.name}</p>
              )}

              <div className="flex items-center justify-between">
                {selectedSkinId === skin.id ? (
                  <span className="text-[10px] text-noxara-success font-medium">SELECTED</span>
                ) : (
                  <span className="text-[10px] text-transparent">.</span>
                )}
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                  <button
                    onClick={() => {
                      setRenamingId(skin.id);
                      setRenameValue(skin.name);
                    }}
                    aria-label="Rename"
                    className="text-noxara-muted hover:text-noxara-text p-1"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => handleDelete(skin.id)}
                    aria-label="Delete"
                    className="text-noxara-muted hover:text-noxara-error p-1"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
