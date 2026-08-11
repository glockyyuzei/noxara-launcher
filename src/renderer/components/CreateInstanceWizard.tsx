import { useEffect, useMemo, useState } from "react";
import type { CreateInstanceInput, InstanceRecord, VersionManifestEntry } from "@shared/types/ipc";

const LOADERS: CreateInstanceInput["loader"][] = ["vanilla", "fabric", "forge"];

export function CreateInstanceWizard({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (instance: InstanceRecord) => void;
}) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [versions, setVersions] = useState<VersionManifestEntry[]>([]);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [minecraftVersion, setMinecraftVersion] = useState<string | null>(null);
  const [loader, setLoader] = useState<CreateInstanceInput["loader"]>("vanilla");
  const [minRam, setMinRam] = useState(2048);
  const [maxRam, setMaxRam] = useState(4096);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    window.noxara.getVersionManifest().then((manifest) => {
      setVersions(manifest.versions);
      setMinecraftVersion((v) => v ?? manifest.latest.release);
    });
  }, []);

  const visibleVersions = useMemo(
    () => versions.filter((v) => showSnapshots || v.type === "release").slice(0, 100),
    [versions, showSnapshots]
  );

  async function handleCreate() {
    if (!minecraftVersion) return;
    setSubmitting(true);
    setError(null);
    try {
      const instance = await window.noxara.createInstance({
        name: name.trim() || `New Instance`,
        minecraftVersion,
        loader,
        loaderVersion: loader === "vanilla" ? null : "latest",
        minRamMb: minRam,
        maxRamMb: maxRam,
      });
      onCreated(instance);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create instance");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8">
      <div className="yz-card w-full max-w-lg flex flex-col max-h-full">
        <div className="px-6 py-4 border-b border-noxara-border flex items-center justify-between">
          <div className="text-sm font-semibold">Create Instance</div>
          <div className="text-xs text-noxara-muted">Step {step} of 4</div>
        </div>

        <div className="p-6 overflow-y-auto space-y-5">
          {step === 1 && (
            <div>
              <label className="yz-label block mb-2">Instance Name</label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Eclipse Cobbleverse"
                className="yz-input w-full"
              />
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="yz-label">Minecraft Version</label>
                <label className="text-xs text-noxara-muted flex items-center gap-1.5">
                  <input type="checkbox" checked={showSnapshots} onChange={(e) => setShowSnapshots(e.target.checked)} />
                  Show snapshots
                </label>
              </div>
              <div className="max-h-64 overflow-y-auto border border-noxara-border rounded">
                {visibleVersions.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setMinecraftVersion(v.id)}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-noxara-elevated transition-colors ${
                      minecraftVersion === v.id ? "bg-noxara-elevated text-noxara-white" : "text-noxara-subtle"
                    }`}
                  >
                    <span>{v.id}</span>
                    <span className="text-xs text-noxara-muted">{v.type}</span>
                  </button>
                ))}
                {versions.length === 0 && (
                  <div className="px-3 py-4 text-sm text-noxara-muted text-center">Loading versions…</div>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <label className="yz-label block mb-2">Mod Loader</label>
              <div className="grid grid-cols-2 gap-2">
                {LOADERS.map((l) => {
                  const supported = l === "vanilla" || l === "fabric";
                  return (
                    <button
                      key={l}
                      onClick={() => supported && setLoader(l)}
                      disabled={!supported}
                      title={supported ? undefined : "Not implemented yet"}
                      className={`yz-card px-3 py-2.5 text-sm capitalize transition-colors relative ${
                        loader === l ? "border-noxara-white text-noxara-white" : "text-noxara-subtle hover:border-noxara-border-strong"
                      } ${!supported ? "opacity-40 cursor-not-allowed" : ""}`}
                    >
                      {l}
                      {!supported && <span className="block text-[10px] text-noxara-muted mt-0.5">Coming soon</span>}
                    </button>
                  );
                })}
              </div>
              {loader === "fabric" && (
                <p className="text-xs text-noxara-muted mt-3">
                  The latest stable Fabric loader build for {minecraftVersion} will be resolved and
                  installed automatically from Fabric's meta API.
                </p>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div>
                <label className="yz-label block mb-2">Minimum RAM: {minRam} MB</label>
                <input
                  type="range"
                  min={512}
                  max={16384}
                  step={256}
                  value={minRam}
                  onChange={(e) => setMinRam(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="yz-label block mb-2">Maximum RAM: {maxRam} MB</label>
                <input
                  type="range"
                  min={minRam}
                  max={32768}
                  step={256}
                  value={maxRam}
                  onChange={(e) => setMaxRam(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              {maxRam > 16384 && (
                <p className="text-xs text-noxara-warning">
                  That's a lot of RAM to hand Minecraft — make sure this system actually has it free.
                </p>
              )}
            </div>
          )}

          {error && <p className="text-sm text-noxara-error">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t border-noxara-border flex justify-between">
          <button onClick={step === 1 ? onClose : () => setStep((s) => s - 1)} className="yz-btn-ghost">
            {step === 1 ? "Cancel" : "Back"}
          </button>
          {step < 4 ? (
            <button
              onClick={() => setStep((s) => s + 1)}
              disabled={step === 2 && !minecraftVersion}
              className="yz-btn-primary"
            >
              Next
            </button>
          ) : (
            <button onClick={handleCreate} disabled={submitting} className="yz-btn-primary">
              {submitting ? "Creating…" : "Create Instance"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
