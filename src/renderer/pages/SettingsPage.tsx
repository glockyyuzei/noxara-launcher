import { useEffect, useState } from "react";
import { Save, FolderOpen, Coffee, RefreshCw, RotateCcw } from "lucide-react";
import type { LauncherSettings } from "@shared/types/ipc";
import { PageHeader } from "../components/PageHeader";
import { Separator } from "../components/ui/separator";
import { toast } from "../stores/useToastStore";

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-9 h-5 rounded-full transition-colors duration-150 disabled:opacity-40 shrink-0 ${
        checked ? "bg-noxara-white" : "bg-noxara-elevated border border-noxara-border-strong"
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-noxara-black transition-all duration-150 ${
          checked ? "left-[18px]" : "left-0.5"
        }`}
      />
      <span className="sr-only">{label}</span>
    </button>
  );
}

function Row({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      <div className="min-w-0">
        <div className="text-sm text-noxara-text">{title}</div>
        <div className="text-xs text-noxara-muted mt-0.5">{description}</div>
      </div>
      <div className="shrink-0 flex items-center gap-2">{children}</div>
    </div>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<LauncherSettings | null>(null);
  const [draft, setDraft] = useState<LauncherSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.noxara.getSettings().then((s) => {
      setSettings(s);
      setDraft(s);
    });
  }, []);

  if (!settings || !draft) {
    return (
      <div className="p-4 md:p-6 max-w-3xl mx-auto">
        <PageHeader title="Settings" subtitle="Launcher-wide preferences." />
        <div className="space-y-2">
          <div className="yz-skeleton h-14 rounded-md" />
          <div className="yz-skeleton h-14 rounded-md" />
          <div className="yz-skeleton h-14 rounded-md" />
        </div>
      </div>
    );
  }

  const dirty = JSON.stringify(settings) !== JSON.stringify(draft);

  const set = <K extends keyof LauncherSettings>(key: K, value: LauncherSettings[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  async function handleSave() {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await window.noxara.setSettings(draft);
      setSettings(saved);
      setDraft(saved);
      toast.success("Settings saved", "Changes will apply to new instances and future launches.");
    } catch (e) {
      toast.error("Couldn't save settings", e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    const saved = await window.noxara.setSettings({
      gameDir: "",
      defaultJavaPath: "",
      autoDetectJava: true,
      defaultMinRamMb: 2048,
      defaultMaxRamMb: 4096,
      launchWidth: 854,
      launchHeight: 480,
      minimizeOnLaunch: false,
      closeOnLaunch: false,
      startMinimized: false,
      showSnapshots: false,
      maxConcurrentDownloads: 8,
    });
    setSettings(saved);
    setDraft(saved);
    toast.success("Settings reset to defaults");
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <PageHeader
        title="Settings"
        subtitle="Launcher-wide preferences, saved automatically to disk."
        actions={
          <>
            <button onClick={handleReset} className="yz-btn-ghost text-xs">
              <RotateCcw size={13} /> Reset
            </button>
            <button onClick={handleSave} disabled={!dirty || saving} className="yz-btn-primary text-sm disabled:opacity-40">
              <Save size={14} /> {saving ? "Saving…" : "Save Changes"}
            </button>
          </>
        }
      />

      <div className="yz-card px-5 py-2">
        <div className="flex items-center gap-2 py-3">
          <FolderOpen size={15} className="text-noxara-subtle" />
          <h2 className="text-sm font-semibold text-noxara-text">Game Directory</h2>
        </div>
        <Row title="Instance location" description="Where new instances are created. Leave empty to use the launcher default.">
          <div className="flex items-center gap-2 w-72 max-w-[50vw]">
            <input
              value={draft.gameDir}
              onChange={(e) => set("gameDir", e.target.value)}
              placeholder="Default (inside launcher data)"
              className="yz-input w-full text-xs font-mono"
            />
            <button
              onClick={async () => {
                const picked = await window.noxara.pickFolder("Choose a game directory");
                if (picked) set("gameDir", picked);
              }}
              className="yz-btn-secondary text-xs px-2.5 py-1.5 shrink-0"
            >
              Browse
            </button>
          </div>
        </Row>
      </div>

      <div className="yz-card px-5 py-2 mt-4">
        <div className="flex items-center gap-2 py-3">
          <Coffee size={15} className="text-noxara-subtle" />
          <h2 className="text-sm font-semibold text-noxara-text">Java & Runtime</h2>
        </div>
        <Row
          title="Auto-detect Java"
          description="Automatically pick the best installed Java runtime for each Minecraft version."
        >
          <Toggle checked={draft.autoDetectJava} onChange={(v) => set("autoDetectJava", v)} label="Auto-detect Java" />
        </Row>
        <Row
          title="Default Java path"
          description="Used when auto-detect is off and an instance has no Java pinned."
        >
          <div className="flex items-center gap-2 w-72 max-w-[50vw]">
            <input
              value={draft.defaultJavaPath}
              onChange={(e) => set("defaultJavaPath", e.target.value)}
              disabled={draft.autoDetectJava}
              placeholder="No default Java"
              className="yz-input w-full text-xs font-mono disabled:opacity-40"
            />
            <button
              disabled={draft.autoDetectJava}
              onClick={async () => {
                const picked = await window.noxara.pickJavaExecutable();
                if (picked) set("defaultJavaPath", picked);
              }}
              className="yz-btn-secondary text-xs px-2.5 py-1.5 shrink-0 disabled:opacity-40"
            >
              Browse
            </button>
          </div>
        </Row>
        <Row
          title="Default memory"
          description="RAM allocated to new instances (min – max)."
        >
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={512}
              step={512}
              value={draft.defaultMinRamMb}
              onChange={(e) => set("defaultMinRamMb", Math.max(512, Number(e.target.value) || 512))}
              className="yz-input w-24 text-xs"
              aria-label="Default minimum RAM (MB)"
            />
            <span className="text-xs text-noxara-muted">to</span>
            <input
              type="number"
              min={512}
              step={512}
              value={draft.defaultMaxRamMb}
              onChange={(e) => set("defaultMaxRamMb", Math.max(512, Number(e.target.value) || 512))}
              className="yz-input w-24 text-xs"
              aria-label="Default maximum RAM (MB)"
            />
            <span className="text-xs text-noxara-muted">MB</span>
          </div>
        </Row>
      </div>

      <div className="yz-card px-5 py-2 mt-4">
        <div className="flex items-center gap-2 py-3">
          <RefreshCw size={15} className="text-noxara-subtle" />
          <h2 className="text-sm font-semibold text-noxara-text">Launch</h2>
        </div>
        <Row
          title="Default window size"
          description="Resolution used by new instances unless the game overrides it."
        >
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={320}
              value={draft.launchWidth}
              onChange={(e) => set("launchWidth", Math.max(320, Number(e.target.value) || 320))}
              className="yz-input w-20 text-xs"
              aria-label="Window width"
            />
            <span className="text-xs text-noxara-muted">×</span>
            <input
              type="number"
              min={240}
              value={draft.launchHeight}
              onChange={(e) => set("launchHeight", Math.max(240, Number(e.target.value) || 240))}
              className="yz-input w-20 text-xs"
              aria-label="Window height"
            />
            <span className="text-xs text-noxara-muted">px</span>
          </div>
        </Row>
        <Separator />
        <Row
          title="Minimize on launch"
          description="Minimize the launcher window while the game is running."
        >
          <Toggle checked={draft.minimizeOnLaunch} onChange={(v) => set("minimizeOnLaunch", v)} label="Minimize on launch" />
        </Row>
        <Row
          title="Close window on launch"
          description="Close the launcher window when the game starts; the launcher quits once the game exits (it stays alive in the background so the game keeps running)."
        >
          <Toggle checked={draft.closeOnLaunch} onChange={(v) => set("closeOnLaunch", v)} label="Close window on launch" />
        </Row>
        <Row
          title="Start minimized"
          description="Open the launcher hidden to the taskbar."
        >
          <Toggle checked={draft.startMinimized} onChange={(v) => set("startMinimized", v)} label="Start minimized" />
        </Row>
      </div>

      <div className="yz-card px-5 py-2 mt-4">
        <div className="flex items-center gap-2 py-3">
          <RefreshCw size={15} className="text-noxara-subtle" />
          <h2 className="text-sm font-semibold text-noxara-text">Downloading</h2>
        </div>
        <Row
          title="Show snapshots"
          description="List snapshot Minecraft versions when creating instances."
        >
          <Toggle checked={draft.showSnapshots} onChange={(v) => set("showSnapshots", v)} label="Show snapshots" />
        </Row>
        <Row
          title="Concurrent downloads"
          description="How many files the launcher can download at once (1–16)."
        >
          <input
            type="number"
            min={1}
            max={16}
            value={draft.maxConcurrentDownloads}
            onChange={(e) =>
              set("maxConcurrentDownloads", Math.min(16, Math.max(1, Number(e.target.value) || 1)))
            }
            className="yz-input w-20 text-xs"
            aria-label="Concurrent downloads"
          />
        </Row>
      </div>

      {dirty && (
        <div className="flex justify-end mt-5">
          <button onClick={handleSave} disabled={saving} className="yz-btn-primary">
            <Save size={14} /> {saving ? "Saving…" : "Save Changes"}
          </button>
        </div>
      )}
    </div>
  );
}
