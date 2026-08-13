import { useEffect, lazy, Suspense, useState } from "react";
import { Routes, Route } from "react-router-dom";
import { TitleBar } from "./layouts/TitleBar";
import { Sidebar } from "./layouts/Sidebar";
import { ToastContainer } from "./components/ToastContainer";
import { ActivityOverlay } from "./components/ActivityOverlay";
import { CommandPalette } from "./components/CommandPalette";
import { useLaunchStore } from "./stores/useLaunchStore";
import { useAccountStore } from "./stores/useAccountStore";
import { useActivityStore } from "./stores/useActivityStore";
import { analyzeCrash } from "./lib/crashAnalysis";
import { applyAppearance } from "./lib/appearance";
import { toast } from "./stores/useToastStore";
import HomePage from "./pages/HomePage";
import InstancesPage from "./pages/InstancesPage";
import InstanceDetailPage from "./pages/InstanceDetailPage";
import AccountsPage from "./pages/AccountsPage";
import JavaPage from "./pages/JavaPage";
import ModsPage from "./pages/ModsPage";
import ModpacksPage from "./pages/ModpacksPage";
import ResourcePacksPage from "./pages/ResourcePacksPage";
import ShadersPage from "./pages/ShadersPage";
import ServersPage from "./pages/ServersPage";
import DownloadsPage from "./pages/DownloadsPage";
import SettingsPage from "./pages/SettingsPage";
import StoragePage from "./pages/StoragePage";

// The 3D skin viewer pulls in three.js (~600 kB), so SkinsPage is loaded on demand to
// keep it out of the initial bundle.
const SkinsPage = lazy(() => import("./pages/SkinsPage"));

export default function App() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const appendLog = useLaunchStore((s) => s.appendLog);
  const markRunning = useLaunchStore((s) => s.markRunning);
  const markCrashed = useLaunchStore((s) => s.markCrashed);
  const refreshRunning = useLaunchStore((s) => s.refreshRunning);
  const refreshAccounts = useAccountStore((s) => s.refresh);
  const hydrateActivities = useActivityStore((s) => s.hydrate);
  const applyActivityUpdate = useActivityStore((s) => s.applyUpdate);
  const applyActivityRemoved = useActivityStore((s) => s.applyRemoved);

  // Load the account list once at app start so the bottom-left selector,
  // home screen, and accounts page all read from the same populated store.
  useEffect(() => {
    refreshAccounts();
  }, [refreshAccounts]);

  // Apply appearance settings (UI scale / compact mode / animations) on startup and
  // again whenever Settings saves (via a custom event from the settings page).
  useEffect(() => {
    const apply = () => window.noxara.getSettings().then(applyAppearance).catch(() => undefined);
    apply();
    window.addEventListener("noxara:settings-applied", apply);
    return () => window.removeEventListener("noxara:settings-applied", apply);
  }, []);

  useEffect(() => {
    const offStarted = window.noxara.onGameStarted((p) => markRunning(p.instanceId, true));
    const offOutput = window.noxara.onGameOutput((p) => {
      appendLog(p);
      markRunning(p.instanceId, true);
    });
    const offExit = window.noxara.onGameExit((p) => {
      markRunning(p.instanceId, false);
      if (p.crashed) {
        // Diagnose from the real log tail + exit code, then let the UI surface the
        // CrashInfo (banner with VIEW LOG / COPY ERROR / RESTART / REPAIR) wherever
        // the instance is shown. Clear is handled by launchInstance() on retry.
        // Read logs imperatively so this subscription never re-binds on new output.
        const tail = useLaunchStore.getState().logsByInstance[p.instanceId] ?? [];
        const info = analyzeCrash(tail, p.code);
        markCrashed(p.instanceId, info);
        toast.error(info.reason, p.code !== null ? `Exit code ${p.code}` : undefined);
      }
    });

    // Global activity registry (overlay + Downloads pages) — subscribe + seed once.
    const offActivityUpdated = window.noxara.onActivityUpdated((p) => applyActivityUpdate(p));
    const offActivityRemoved = window.noxara.onActivityRemoved((p) => applyActivityRemoved(p));
    hydrateActivities();

    // Reconcile running state against the core's actual process registry so the UI
    // stays accurate even if a process is killed manually or crashes without events.
    refreshRunning();
    const pollTimer = setInterval(refreshRunning, 4000);
    const onFocus = () => refreshRunning();
    window.addEventListener("focus", onFocus);

    return () => {
      offStarted();
      offOutput();
      offExit();
      offActivityUpdated();
      offActivityRemoved();
      clearInterval(pollTimer);
      window.removeEventListener("focus", onFocus);
    };
  }, [appendLog, markRunning, markCrashed, refreshRunning, applyActivityUpdate, applyActivityRemoved, hydrateActivities]);

  // Ctrl/Cmd+K opens the global search palette anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-noxara-black">
      <TitleBar onOpenSearch={() => setPaletteOpen(true)} />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center p-8">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-noxara-border border-t-noxara-text" />
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/instances" element={<InstancesPage />} />
              <Route path="/instances/:id" element={<InstanceDetailPage />} />
              <Route path="/accounts" element={<AccountsPage />} />
              <Route path="/java" element={<JavaPage />} />
              <Route path="/modpacks" element={<ModpacksPage />} />
              <Route path="/mods" element={<ModsPage />} />
              <Route path="/resourcepacks" element={<ResourcePacksPage />} />
              <Route path="/shaders" element={<ShadersPage />} />
              <Route path="/servers" element={<ServersPage />} />
              <Route path="/skins" element={<SkinsPage />} />
              <Route path="/downloads" element={<DownloadsPage />} />
              <Route path="/storage" element={<StoragePage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </Suspense>
        </main>
      </div>
      <ActivityOverlay />
      <ToastContainer />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
