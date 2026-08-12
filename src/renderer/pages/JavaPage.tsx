import { useEffect, useState } from "react";
import { RefreshCw, Coffee } from "lucide-react";
import type { JavaInstallation } from "@shared/types/ipc";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";

export default function JavaPage() {
  const [installs, setInstalls] = useState<JavaInstallation[]>([]);
  const [loading, setLoading] = useState(true);
  const [customPath, setCustomPath] = useState("");
  const [customResult, setCustomResult] = useState<JavaInstallation | null | "invalid">(null);

  function refresh() {
    setLoading(true);
    window.noxara.detectJava().then((list) => {
      setInstalls(list);
      setLoading(false);
    });
  }
  useEffect(refresh, []);

  async function testCustomPath() {
    const result = await window.noxara.testJavaPath(customPath);
    setCustomResult(result ?? "invalid");
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">
      <PageHeader
        title="Java"
        subtitle="Detected Java runtimes and custom paths used to launch instances."
        actions={
          <button onClick={refresh} className="yz-btn-secondary">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Rescan
          </button>
        }
      />

      <div className="space-y-2 mb-8">
        {loading ? (
          <>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="yz-card px-4 py-3">
                <div className="yz-skeleton h-4 w-40 rounded mb-2" />
                <div className="yz-skeleton h-3 w-64 rounded" />
              </div>
            ))}
          </>
        ) : (
          installs.map((j) => (
            <div key={j.path} className="yz-card px-4 py-3 flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium text-noxara-text">
                  Java {j.majorVersion} {j.vendor ? `· ${j.vendor}` : ""}
                </div>
                <div className="text-xs text-noxara-muted font-mono truncate max-w-md">{j.path}</div>
              </div>
              <span className="text-xs text-noxara-subtle shrink-0">{j.is64bit ? "64-bit" : "32-bit"}</span>
            </div>
          ))
        )}
        {!loading && installs.length === 0 && (
          <EmptyState
            icon={Coffee}
            title="No Java installations detected"
            description="Add a custom path below, or install Java manually."
          />
        )}
      </div>

      <div className="yz-card p-4">
        <label className="yz-label block mb-2">Add Custom Java Path</label>
        <div className="flex gap-2">
          <input
            value={customPath}
            onChange={(e) => setCustomPath(e.target.value)}
            placeholder="/usr/lib/jvm/java-21-openjdk/bin/java"
            className="yz-input flex-1 font-mono text-xs"
          />
          <button onClick={testCustomPath} className="yz-btn-secondary shrink-0">Test</button>
        </div>
        {customResult === "invalid" && (
          <p className="text-xs text-noxara-error mt-2">That path doesn't run as a valid Java executable.</p>
        )}
        {customResult && customResult !== "invalid" && (
          <p className="text-xs text-noxara-success mt-2">
            Verified: Java {customResult.majorVersion} ({customResult.version})
          </p>
        )}
      </div>
    </div>
  );
}
