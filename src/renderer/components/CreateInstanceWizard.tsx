import { useEffect, useMemo, useState } from "react";
import type { CreateInstanceInput, InstanceRecord, VersionManifestEntry, ForgeVersion } from "@shared/types/ipc";

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
  const [forgeVersions, setForgeVersions] = useState<ForgeVersion[]>([]);
  const [forgeVersionsLoading, setForgeVersionsLoading] = useState(false);
  const [forgeVersionsError, setForgeVersionsError] = useState<string | null>(null);
  const [selectedForgeVersion, setSelectedForgeVersion] = useState<string | null>(null);
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

  // Fetch real, currently-published Forge builds for whichever Minecraft version is
  // selected — never auto-pick versions[0] silently; the user chooses from this list
  // (defaulting the selection to Forge's own "recommended" tag when one exists).
  useEffect(() => {
    if (loader !== "forge" || !minecraftVersion) return;
    let cancelled = false;
    setForgeVersionsLoading(true);
    setForgeVersionsError(null);
    setForgeVersions([]);
    setSelectedForgeVersion(null);
    window.noxara
      .getForgeVersions(minecraftVersion)
      .then((list) => {
        if (cancelled) return;
        setForgeVersions(list);
        const preferred = list.find((v) => v.recommended) ?? list.find((v) => v.latest) ?? list[0];
        setSelectedForgeVersion(preferred?.fullVersion ?? null);
      })
      .catch((e) => {
        if (cancelled) return;
        setForgeVersionsError(e instanceof Error ? e.message : "Failed to load Forge versions");
      })
      .finally(() => {
        if (!cancelled) setForgeVersionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loader, minecraftVersion]);

  const visibleVersions = useMemo(
    () => versions.filter((v) => showSnapshots || v.type === "release").slice(0, 100),
    [versions, showSnapshots]
  );

  async function handleCreate() {
    if (!minecraftVersion) return;
    if (loader === "forge" && !selectedForgeVersion) {
      setError("Select a Forge version first");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const instance = await window.noxara.createInstance({
        name: name.trim() || `New Instance`,
        minecraftVersion,
        loader,
        loaderVersion: loader === "vanilla" ? null : loader === "forge" ? selectedForgeVersion : "latest",
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
              <div className="grid grid-cols-3 gap-2">
                {LOADERS.map((l) => (
                  <button
                    key={l}
                    onClick={() => setLoader(l)}
                    className={`yz-card px-3 py-2.5 text-sm capitalize transition-colors relative ${
                      loader === l ? "border-noxara-white text-noxara-white" : "text-noxara-subtle hover:border-noxara-border-strong"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>

              {loader === "fabric" && (
                <p className="text-xs text-noxara-muted mt-3">
                  The latest stable Fabric loader build for {minecraftVersion} will be resolved and
                  installed automatically from Fabric's meta API.
                </p>
              )}

              {loader === "forge" && (
                <div className="mt-3">
                  <label className="yz-label block mb-2">Forge Version</label>
                  {forgeVersionsLoading && (
                    <div className="text-sm text-noxara-muted px-3 py-4 text-center border border-noxara-border rounded">
                      Loading Forge builds for {minecraftVersion}…
                    </div>
                  )}
                  {forgeVersionsError && (
                    <div className="text-sm text-noxara-error px-3 py-3 border border-noxara-border rounded">
                      {forgeVersionsError}
                    </div>
                  )}
                  {!forgeVersionsLoading && !forgeVersionsError && (
                    <div className="max-h-48 overflow-y-auto border border-noxara-border rounded">
                      {forgeVersions.map((v) => (
                        <button
                          key={v.fullVersion}
                          onClick={() => setSelectedForgeVersion(v.fullVersion)}
                          className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-noxara-elevated transition-colors ${
                            selectedForgeVersion === v.fullVersion ? "bg-noxara-elevated text-noxara-white" : "text-noxara-subtle"
                          }`}
                        >
                          <span>{v.forgeVersion}</span>
                          <span className="text-xs text-noxara-muted">
                            {v.recommended ? "Recommended" : v.latest ? "Latest" : ""}
                          </span>
                        </button>
                      ))}
                      {forgeVersions.length === 0 && (
                        <div className="px-3 py-4 text-sm text-noxara-muted text-center">
                          No Forge builds found for {minecraftVersion}
                        </div>
                      )}
                    </div>
                  )}
                  <p className="text-xs text-noxara-muted mt-3">
                    Installing Forge runs its own installer tools the first time this build is used
                    (usually under a minute) — you'll see progress on first launch.
                  </p>
                </div>
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
