import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, AlertCircle, RotateCcw } from "lucide-react";
import type { CreateInstanceInput, InstanceRecord, VersionManifestEntry } from "@shared/types/ipc";
import { LOADERS, fetchLoaderVersions, preferredLoaderVersion, type LoaderId } from "../lib/loaders";

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
  const [loader, setLoader] = useState<LoaderId>("vanilla");
  const [loaderVersions, setLoaderVersions] = useState<{ version: string; display: string; tag: string }[]>([]);
  const [loaderVersionsLoading, setLoaderVersionsLoading] = useState(false);
  const [loaderVersionsError, setLoaderVersionsError] = useState<string | null>(null);
  const [loaderVersionReloadKey, setLoaderVersionReloadKey] = useState(0);
  const [selectedVersion, setSelectedVersion] = useState<string | null>(null);
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

  // Honor the user's launcher defaults (Settings → Game/Java/Memory): new instances
  // start at the configured RAM and snapshot visibility instead of hardcoded values.
  useEffect(() => {
    window.noxara.getSettings().then((s) => {
      setMinRam(s.defaultMinRamMb);
      setMaxRam(Math.max(s.defaultMaxRamMb, s.defaultMinRamMb));
      setShowSnapshots(s.showSnapshots);
    });
  }, []);

  // Fetch real, currently-published loader builds for whichever Minecraft version is
  // selected. All four loaders share the unified registry in lib/loaders.ts. The newest
  // stable (or tagged "recommended"/"latest") build is pre-selected; switching
  // Minecraft versions re-fetches compatible builds. None of this is hardcoded.
  useEffect(() => {
    if (loader === "vanilla" || !minecraftVersion) return;
    let cancelled = false;
    setLoaderVersionsLoading(true);
    setLoaderVersionsError(null);
    setLoaderVersions([]);
    setSelectedVersion(null);
    fetchLoaderVersions(loader, minecraftVersion)
      .then((items) => {
        if (cancelled) return;
        setLoaderVersions(items);
        setSelectedVersion(preferredLoaderVersion(items));
      })
      .catch((e) => {
        if (cancelled) return;
        setLoaderVersionsError(e instanceof Error ? e.message : "Failed to load loader versions");
      })
      .finally(() => {
        if (!cancelled) setLoaderVersionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loader, minecraftVersion, loaderVersionReloadKey]);

  const visibleVersions = useMemo(
    () => versions.filter((v) => showSnapshots || v.type === "release").slice(0, 100),
    [versions, showSnapshots]
  );

  async function handleCreate() {
    if (!minecraftVersion) return;
    if (loader !== "vanilla" && !selectedVersion) {
      setError(
        loaderVersionsError
          ? "No loader version could be loaded for this Minecraft version"
          : "Select a loader version first"
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const instance = await window.noxara.createInstance({
        name: name.trim() || `New Instance`,
        minecraftVersion,
        loader,
        loaderVersion: loader === "vanilla" ? null : selectedVersion,
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
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                {LOADERS.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setLoader(l.id)}
                    className={`yz-card px-3 py-3 text-sm transition-all duration-150 flex items-center justify-center gap-1.5 ${
                      loader === l.id
                        ? "border-noxara-white text-noxara-white"
                        : "text-noxara-subtle hover:border-noxara-border-strong"
                    }`}
                  >
                    {l.name}
                    {loader === l.id && <Check size={13} strokeWidth={2.5} />}
                  </button>
                ))}
              </div>

              {loader === "vanilla" && (
                <p className="text-xs text-noxara-muted mt-3">Vanilla instances run unmodified Minecraft.</p>
              )}

              {loader !== "vanilla" && (
                <div className="mt-3">
                  <label className="yz-label block mb-2">
                    {loader === "fabric"
                      ? "Fabric Loader Version"
                      : loader === "quilt"
                        ? "Quilt Loader Version"
                        : loader === "forge"
                          ? "Forge Version"
                          : "NeoForge Version"}
                  </label>
                  {loaderVersionsLoading && (
                    <div className="text-sm text-noxara-muted px-3 py-4 text-center border border-noxara-border rounded flex items-center justify-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      Loading {loader} builds for {minecraftVersion}…
                    </div>
                  )}
                  {loaderVersionsError && (
                    <div className="text-sm text-noxara-error px-3 py-3 border border-noxara-border rounded flex items-start gap-2">
                      <AlertCircle size={14} className="shrink-0 mt-0.5" />
                      <span className="flex-1">{loaderVersionsError}</span>
                      <button
                        onClick={() => setLoaderVersionReloadKey((k) => k + 1)}
                        className="text-noxara-muted hover:text-noxara-text flex items-center gap-1 shrink-0"
                        title="Try again"
                      >
                        <RotateCcw size={13} />
                        Retry
                      </button>
                    </div>
                  )}
                  {!loaderVersionsLoading && !loaderVersionsError && loaderVersions.length > 0 && (
                    <div className="max-h-48 overflow-y-auto border border-noxara-border rounded">
                      {loaderVersions.map((v) => (
                        <button
                          key={v.version}
                          onClick={() => setSelectedVersion(v.version)}
                          className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-noxara-elevated transition-colors ${
                            selectedVersion === v.version ? "bg-noxara-elevated text-noxara-white" : "text-noxara-subtle"
                          }`}
                        >
                          <span>{v.display}</span>
                          {v.tag && <span className="text-xs text-noxara-muted">{v.tag}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {!loaderVersionsLoading && !loaderVersionsError && loaderVersions.length === 0 && (
                    <div className="px-3 py-4 text-sm text-noxara-muted text-center">
                      No published {loader} builds were found for Minecraft {minecraftVersion}. This
                      Minecraft version may not be supported by {loader === "neoforge" ? "NeoForge" : loader === "fabric" ? "Fabric" : loader === "quilt" ? "the Quilt Loader" : loader}.
                    </div>
                  )}
                  <p className="text-xs text-noxara-muted mt-3">
                    {loader === "forge" || loader === "neoforge"
                      ? `${loader === "forge" ? "Forge" : "NeoForge"} installs its own installer tools the first time the build is used (usually under a minute) — you'll see progress on first launch.`
                      : `The newest stable loader build is pre-selected. You can pick any published build below — a build that won't work with this Minecraft version won't be listed.`}
                  </p>
                </div>
              )}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="yz-label">Minimum RAM</label>
                  <span className="text-sm font-medium text-noxara-text tabular-nums">{minRam} MB</span>
                </div>
                <input
                  type="range"
                  min={512}
                  max={16384}
                  step={256}
                  value={minRam}
                  onChange={(e) => setMinRam(Number(e.target.value))}
                  className="yz-range"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="yz-label">Maximum RAM</label>
                  <span className="text-sm font-medium text-noxara-text tabular-nums">{maxRam} MB</span>
                </div>
                <input
                  type="range"
                  min={minRam}
                  max={32768}
                  step={256}
                  value={maxRam}
                  onChange={(e) => setMaxRam(Number(e.target.value))}
                  className="yz-range"
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
