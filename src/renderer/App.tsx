import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { TitleBar } from "./layouts/TitleBar";
import { Sidebar } from "./layouts/Sidebar";
import { ToastContainer } from "./components/ToastContainer";
import { useLaunchStore } from "./stores/useLaunchStore";
import { useAccountStore } from "./stores/useAccountStore";
import { useDownloadStore } from "./stores/useDownloadStore";
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
import SkinsPage from "./pages/SkinsPage";
import DownloadsPage from "./pages/DownloadsPage";
import SettingsPage from "./pages/SettingsPage";

export default function App() {
  const appendLog = useLaunchStore((s) => s.appendLog);
  const markRunning = useLaunchStore((s) => s.markRunning);
  const refreshRunning = useLaunchStore((s) => s.refreshRunning);
  const refreshAccounts = useAccountStore((s) => s.refresh);
  const onModProgress = useDownloadStore((s) => s.onProgress);
  const onModComplete = useDownloadStore((s) => s.onComplete);
  const onBatchProgress = useDownloadStore((s) => s.onBatchProgress);
  const onBatchComplete = useDownloadStore((s) => s.onBatchComplete);
  const onForgeProgress = useDownloadStore((s) => s.onForgeProgress);

  // Load the account list once at app start so the bottom-left selector,
  // home screen, and accounts page all read from the same populated store.
  useEffect(() => {
    refreshAccounts();
  }, [refreshAccounts]);

  useEffect(() => {
    const offProgress = window.noxara.onDownloadProgress((p) => onBatchProgress(p));
    const offComplete = window.noxara.onDownloadComplete((p) => {
      onBatchComplete(p);
      if (p.failed.length > 0) {
        toast.error("Some files failed to download", `${p.failed.length} file(s) could not be downloaded`);
      }
    });
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
    const offModProgress = window.noxara.onModDownloadProgress((p) => onModProgress(p));
    const offModComplete = window.noxara.onModDownloadComplete((p) => {
      onModComplete(p);
      if (!p.success) toast.error("Mod download failed", p.error);
    });
    const offContentProgress = window.noxara.onContentDownloadProgress((p) => onModProgress(p));
    const offContentComplete = window.noxara.onContentDownloadComplete((p) => {
      onModComplete(p);
      if (!p.success) toast.error("Download failed", p.error);
    });
    const offForgeProgress = window.noxara.onForgeInstallProgress((p) => {
      onForgeProgress(p);
      if (p.stage === "complete") toast.success("Loader installed", p.message);
    });

    // Reconcile running state against the core's actual process registry so the UI
    // stays accurate even if a process is killed manually or crashes without events.
    refreshRunning();
    const pollTimer = setInterval(refreshRunning, 4000);
    const onFocus = () => refreshRunning();
    window.addEventListener("focus", onFocus);

    return () => {
      offProgress();
      offComplete();
      offStarted();
      offOutput();
      offExit();
      offModProgress();
      offModComplete();
      offContentProgress();
      offContentComplete();
      offForgeProgress();
      clearInterval(pollTimer);
      window.removeEventListener("focus", onFocus);
    };
  }, [appendLog, markRunning, refreshRunning, onModProgress, onModComplete, onBatchProgress, onBatchComplete, onForgeProgress]);

  return (
    <div className="h-screen w-screen flex flex-col bg-noxara-black">
      <TitleBar />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
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
        </main>
      </div>
      <ToastContainer />
    </div>
  );
}
