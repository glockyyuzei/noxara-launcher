import { Minus, Square, X } from "lucide-react";
import { Tooltip } from "../components/Tooltip";

export function TitleBar() {
  return (
    <div className="h-9 flex items-center justify-between bg-noxara-black border-b border-noxara-border titlebar-drag select-none shrink-0">
      <div className="px-4 text-xs font-semibold tracking-widest text-noxara-subtle">NOXARA LAUNCHER</div>
      <div className="flex titlebar-no-drag">
        <Tooltip label="Minimize" side="bottom" delay={600}>
          <button
            onClick={() => window.noxara.windowMinimize()}
            className="w-11 h-9 flex items-center justify-center text-noxara-subtle hover:bg-noxara-surface hover:text-noxara-text transition-colors duration-150"
            aria-label="Minimize"
          >
            <Minus size={14} />
          </button>
        </Tooltip>
        <Tooltip label="Maximize" side="bottom" delay={600}>
          <button
            onClick={() => window.noxara.windowMaximize()}
            className="w-11 h-9 flex items-center justify-center text-noxara-subtle hover:bg-noxara-surface hover:text-noxara-text transition-colors duration-150"
            aria-label="Maximize"
          >
            <Square size={11} />
          </button>
        </Tooltip>
        <Tooltip label="Close" side="bottom" delay={600}>
          <button
            onClick={() => window.noxara.windowClose()}
            className="w-11 h-9 flex items-center justify-center text-noxara-subtle hover:bg-noxara-error hover:text-noxara-white transition-colors duration-150"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
