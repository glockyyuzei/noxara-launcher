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
import SkinsPage from "./pages/SkinsPage";
import DownloadsPage from "./pages/DownloadsPage";
import ComingSoonPage from "./pages/ComingSoonPage";

export default function App() {
  const setActiveDownload = useLaunchStore((s) => s.setActiveDownload);
  const appendLog = useLaunchStore((s) => s.appendLog);
  const markRunning = useLaunchStore((s) => s.markRunning);
  const refreshAccounts = useAccountStore((s) => s.refresh);
  const onModProgress = useDownloadStore((s) => s.onProgress);
  const onModComplete = useDownloadStore((s) => s.onComplete);

  // Load the account list once at app start so the bottom-left selector,
  // home screen, and accounts page all read from the same populated store.
  useEffect(() => {
    refreshAccounts();
  }, [refreshAccounts]);

  useEffect(() => {
    const offProgress = window.noxara.onDownloadProgress((p) => setActiveDownload(p));
    const offComplete = window.noxara.onDownloadComplete((p) => {
      setActiveDownload(null);
      if (p.failed.length > 0) {
        toast.error("Some files failed to download", `${p.failed.length} file(s) could not be downloaded`);
      } else {
        toast.success("Download complete");
      }
    });
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
    return () => {
      offProgress();
      offComplete();
      offOutput();
      offExit();
      offModProgress();
      offModComplete();
    };
  }, [appendLog, markRunning, setActiveDownload, onModProgress, onModComplete]);

  return (
    <div className="h-screen w-screen flex flex-col bg-noxara-black min-w-[640px]">
      <TitleBar />
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main className="flex-1 min-w-0 overflow-y-auto">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/instances" element={<InstancesPage />} />
            <Route path="/instances/:id" element={<InstanceDetailPage />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/java" element={<JavaPage />} />
            <Route path="/modpacks" element={<ComingSoonPage title="Modpacks" phase="Phase 3" />} />
            <Route path="/mods" element={<ModsPage />} />
            <Route path="/resourcepacks" element={<ComingSoonPage title="Resource Packs" phase="Phase 4" />} />
            <Route path="/shaders" element={<ComingSoonPage title="Shaders" phase="Phase 4" />} />
            <Route path="/servers" element={<ComingSoonPage title="Servers" phase="Phase 4" />} />
            <Route path="/skins" element={<SkinsPage />} />
            <Route path="/downloads" element={<DownloadsPage />} />
            <Route path="/settings" element={<ComingSoonPage title="Settings" phase="Phase 1 (in progress)" />} />
          </Routes>
        </main>
      </div>
      <ToastContainer />
    </div>
  );
}
