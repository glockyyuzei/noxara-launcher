import { useEffect, lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { TitleBar } from "./layouts/TitleBar";
import { Sidebar } from "./layouts/Sidebar";
import { ToastContainer } from "./components/ToastContainer";
import { ActivityOverlay } from "./components/ActivityOverlay";
import { useLaunchStore } from "./stores/useLaunchStore";
import { useAccountStore } from "./stores/useAccountStore";
import { useActivityStore } from "./stores/useActivityStore";
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

// The 3D skin viewer pulls in three.js (~600 kB), so SkinsPage is loaded on demand to
// keep it out of the initial bundle.
const SkinsPage = lazy(() => import("./pages/SkinsPage"));

export default function App() {
  const appendLog = useLaunchStore((s) => s.appendLog);
  const markRunning = useLaunchStore((s) => s.markRunning);
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

  useEffect(() => {
    const offStarted = window.noxara.onGameStarted((p) => markRunning(p.instanceId, true));
    const offOutput = window.noxara.onGameOutput((p) => {
      appendLog(p);
      markRunning(p.instanceId, true);
    });
    const offExit = window.noxara.onGameExit((p) => {
      markRunning(p.instanceId, false);
      if (p.crashed) {
        toast.error("Minecraft crashed", p.code !== null ? `Exit code ${p.code}` : undefined);
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
  }, [appendLog, markRunning, refreshRunning, applyActivityUpdate, applyActivityRemoved, hydrateActivities]);

  return (
    <div className="h-screen w-screen flex flex-col bg-noxara-black">
      <TitleBar />
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
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </Suspense>
        </main>
      </div>
      <ActivityOverlay />
      <ToastContainer />
    </div>
  );
}
