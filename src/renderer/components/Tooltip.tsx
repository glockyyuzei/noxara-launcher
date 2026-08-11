import { useRef, useState, type ReactNode } from "react";

interface TooltipProps {
  label: string;
  children: ReactNode;
  side?: "top" | "bottom" | "right" | "left";
  delay?: number;
}

const SIDE_CLASSES: Record<NonNullable<TooltipProps["side"]>, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
  right: "left-full top-1/2 -translate-y-1/2 ml-1.5",
  left: "right-full top-1/2 -translate-y-1/2 mr-1.5",
};

/** Delayed tooltip meant for icon-only controls; wrap a single focusable child. */
export function Tooltip({ label, children, side = "top", delay = 400 }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  function show() {
    timer.current = setTimeout(() => setVisible(true), delay);
  }
  function hide() {
    clearTimeout(timer.current);
    setVisible(false);
  }

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute z-50 whitespace-nowrap rounded bg-noxara-elevated border border-noxara-border-strong px-2 py-1 text-xs text-noxara-text shadow-lg animate-fade-in ${SIDE_CLASSES[side]}`}
        >
          {label}
        </span>
      )}
    </span>
  );
}
