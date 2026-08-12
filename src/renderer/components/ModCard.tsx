import { Download, Users, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import type { ModrinthSearchHit } from "@shared/types/ipc";

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function ModCard({
  mod,
  installed,
  installing,
  onInstall,
  onOpen,
}: {
  mod: ModrinthSearchHit;
  installed: boolean;
  installing: boolean;
  onInstall: () => void;
  onOpen: () => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <div className="yz-card p-4 flex gap-3.5 hover:border-noxara-border-strong hover:-translate-y-0.5 hover:shadow-card-hover transition-all duration-200">
      <button
        onClick={onOpen}
        className="shrink-0 w-14 h-14 rounded-md bg-noxara-elevated border border-noxara-border overflow-hidden yz-focus-ring"
      >
        {mod.iconUrl && !imgFailed ? (
          <img src={mod.iconUrl} alt="" className="w-full h-full object-cover" onError={() => setImgFailed(true)} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-noxara-muted text-xs font-semibold">
            {mod.title.slice(0, 1).toUpperCase()}
          </div>
        )}
      </button>

      <div className="min-w-0 flex-1">
        <button onClick={onOpen} className="text-left w-full yz-focus-ring rounded">
          <h3 className="text-sm font-semibold text-noxara-text truncate">{mod.title}</h3>
          <p className="text-xs text-noxara-muted mt-0.5 line-clamp-2">{mod.description}</p>
        </button>
        <div className="flex items-center gap-3 mt-2 text-xs text-noxara-muted">
          <span className="flex items-center gap-1">
            <Download size={12} /> {formatCount(mod.downloads)}
          </span>
          <span className="flex items-center gap-1">
            <Users size={12} /> {formatCount(mod.follows)}
          </span>
          {mod.loaders.slice(0, 2).map((l) => (
            <span key={l} className="px-1.5 py-0.5 rounded bg-noxara-elevated border border-noxara-border capitalize">
              {l}
            </span>
          ))}
        </div>
      </div>

      <div className="shrink-0 self-center">
        {installed ? (
          <span className="flex items-center gap-1.5 text-xs text-noxara-success font-medium px-3 py-1.5">
            <CheckCircle2 size={14} /> Installed
          </span>
        ) : (
          <button onClick={onInstall} disabled={installing} className="yz-btn-secondary text-xs px-3 py-1.5">
            {installing ? "Installing…" : "Install"}
          </button>
        )}
      </div>
    </div>
  );
}
