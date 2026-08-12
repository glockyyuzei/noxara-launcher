import { useEffect, useState } from "react";
import { Package, X, Loader2 } from "lucide-react";
import type { InstanceRecord } from "@shared/types/ipc";
import { toast } from "../stores/useToastStore";

function defaultNameFromPath(mrpackPath: string): string {
  const base = mrpackPath.split(/[\\/]/).pop()?.replace(/\.mrpack$/i, "") ?? "Imported Modpack";
  return base
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
    .slice(0, 64);
}

/**
 * Import flow step 2: after a .mrpack was picked from disk, confirm the new instance's
 * name + RAM before the main process creates it and installs the pack. Defaults for the
 * RAM fields come from the launcher settings, and the name defaults to the filename.
 */
export function ModpackImportModal({
  mrpackPath,
  onClose,
  onImported,
}: {
  mrpackPath: string;
  onClose: () => void;
  onImported: (instance: InstanceRecord) => void;
}) {
  const [name, setName] = useState(defaultNameFromPath(mrpackPath));
  const [minRam, setMinRam] = useState("2048");
  const [maxRam, setMaxRam] = useState("4096");
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    window.noxara.getSettings().then((s) => {
      setMinRam(String(s.defaultMinRamMb));
      setMaxRam(String(s.defaultMaxRamMb));
    });
  }, []);

  async function handleImport() {
    setImporting(true);
    try {
      const instance = await window.noxara.importModpackFromFile(mrpackPath, {
        name: name.trim() || defaultNameFromPath(mrpackPath),
        minRamMb: Number(minRam) || 2048,
        maxRamMb: Number(maxRam) || 4096,
      });
      toast.success("Modpack imported", `${instance.name} was created from this pack`);
      onImported(instance);
    } catch (e) {
      toast.error("Couldn't import modpack", e instanceof Error ? e.message : undefined);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 sm:p-8 animate-fade-in">
      <div className="yz-card w-full max-w-md p-6 animate-modal-in">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-noxara-text flex items-center gap-2">
            <Package size={16} className="text-noxara-subtle" /> Import Modpack
          </h2>
          <button onClick={onClose} className="text-noxara-muted hover:text-noxara-text transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="yz-label block mb-1.5">Instance name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My modpack"
              className="yz-input w-full"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="yz-label block mb-1.5">Min RAM (MB)</label>
              <input
                value={minRam}
                onChange={(e) => setMinRam(e.target.value.replace(/[^0-9]/g, ""))}
                className="yz-input w-full tabular-nums"
              />
            </div>
            <div>
              <label className="yz-label block mb-1.5">Max RAM (MB)</label>
              <input
                value={maxRam}
                onChange={(e) => setMaxRam(e.target.value.replace(/[^0-9]/g, ""))}
                className="yz-input w-full tabular-nums"
              />
            </div>
          </div>
          <p className="text-xs text-noxara-muted">
            This creates a brand-new instance from the pack's manifest (Minecraft version + loader),
            then installs all of its mods and overrides.
          </p>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="yz-btn-ghost">
            Cancel
          </button>
          <button onClick={handleImport} disabled={importing} className="yz-btn-primary disabled:opacity-40">
            {importing ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Importing…
              </>
            ) : (
              "Import"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}