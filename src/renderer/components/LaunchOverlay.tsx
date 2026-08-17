/**
 * The Minecraft launch rocket overlay.
 *
 * Appears the moment the user clicks Play (the instance enters the real "launching"
 * state), blurs/dims the launcher behind it, and shows a monochrome Noxara rocket
 * burning on its pad. It stays up for the entire real launch pipeline (file downloads,
 * loader installs, Java resolution) — the status line streams the backend's actual
 * activity description. When the core reports the JVM is running (game.started), the
 * rocket accelerates off-screen and the overlay fades. If the launch fails, crashes, or
 * is cancelled, the overlay fades out and the existing error/crash UI takes over.
 *
 * The overlay is driven by the existing instance lifecycle (useLaunchStore), never by a
 * fake timer that pretends Minecraft is starting.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useLaunchStore } from "../stores/useLaunchStore";
import { useActivityStore } from "../stores/useActivityStore";
import {
  initialRocketState,
  nextRocketState,
  ROCKET_EXIT_MS,
  ROCKET_FADE_MS,
  ROCKET_IGNITION_MS,
  type RocketInput,
  type RocketState,
} from "../lib/launchRocket";

const ACTIVE_PHASES = new Set(["ignition", "hold", "exit", "fade"]);

const PARTICLE_LAYOUT = [
  { left: "38%", drift: "-10px", delay: "0ms" },
  { left: "46%", drift: "-4px", delay: "120ms" },
  { left: "54%", drift: "4px", delay: "60ms" },
  { left: "62%", drift: "10px", delay: "190ms" },
  { left: "50%", drift: "0px", delay: "240ms" },
];

export function LaunchOverlay() {
  const launchingIds = useLaunchStore((s) => s.launchingInstanceIds);
  const runningIds = useLaunchStore((s) => s.runningInstanceIds);
  const crashedIds = useLaunchStore((s) => s.crashedInstanceIds);
  const errorIds = useLaunchStore((s) => s.errorInstanceIds);
  const activities = useActivityStore((s) => s.activities);

  const [state, setState] = useState<RocketState>(initialRocketState);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Drive the phase from the real lifecycle (single source of truth). The Sets are
  // recreated on every store change, so this fires exactly when launch state moves.
  useEffect(() => {
    const next = nextRocketState(stateRef.current, snapshot());
    if (next !== stateRef.current) setState(next);
  }, [launchingIds, runningIds, crashedIds, errorIds]);

  // Presentation-only timers: ignition -> hold, and how long the exit sweep / fade-out
  // takes to finish on screen. Never used to decide when Minecraft is running.
  useEffect(() => {
    if (state.phase === "ignition") {
      const t = setTimeout(
        () => setState((prev) => (prev.phase === "ignition" ? { ...prev, phase: "hold" } : prev)),
        ROCKET_IGNITION_MS
      );
      return () => clearTimeout(t);
    }
    if (state.phase === "exit" || state.phase === "fade") {
      const t = setTimeout(() => {
        // After the animation completes, hand back to the machine from idle so a second
        // instance still launching picks up the overlay immediately.
        setState(nextRocketState({ instanceId: null, phase: "idle" }, snapshot()));
      }, state.phase === "exit" ? ROCKET_EXIT_MS : ROCKET_FADE_MS);
      return () => clearTimeout(t);
    }
  }, [state.phase]);

  if (!ACTIVE_PHASES.has(state.phase)) return null;

  // Real backend status for this instance: the launch (or loader install) activity's
  // live description ("Downloading Minecraft files", "Launching Minecraft", ...).
  const active = activities.find(
    (a) =>
      a.instanceId === state.instanceId &&
      (a.type === "instance" || a.type === "loader") &&
      a.status !== "completed" &&
      a.status !== "failed" &&
      a.status !== "cancelled"
  );

  return (
    <div
      className={`noxara-launch-overlay noxara-launch-${state.phase}`}
      role="status"
      aria-live="polite"
      aria-label="Launching Minecraft"
    >
      <div className="noxara-launch-stage">
        <div className="noxara-launch-rocket">
          <div className="noxara-launch-trail" />
          <svg width="96" height="176" viewBox="0 0 96 176" fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="nxr-body" x1="0" y1="0" x2="96" y2="0">
                <stop offset="0" stopColor="#d9d9d9" />
                <stop offset="0.5" stopColor="#ffffff" />
                <stop offset="1" stopColor="#c9c9c9" />
              </linearGradient>
              <linearGradient id="nxr-nose" x1="0" y1="0" x2="0" y2="80">
                <stop offset="0" stopColor="#ffffff" />
                <stop offset="1" stopColor="#e2e2e2" />
              </linearGradient>
            </defs>
            {/* fins */}
            <path d="M30 108 L10 140 L10 126 L22 106 Z" fill="#8f8f8f" />
            <path d="M66 108 L86 140 L86 126 L74 106 Z" fill="#8f8f8f" />
            {/* body */}
            <path d="M30 60 H66 V132 Q66 140 58 140 H38 Q30 140 30 132 Z" fill="url(#nxr-body)" stroke="#6b6b6b" strokeWidth="1.5" />
            {/* nose cone */}
            <path d="M48 4 C32 34 30 48 30 60 H66 C66 48 64 34 48 4 Z" fill="url(#nxr-nose)" stroke="#6b6b6b" strokeWidth="1.5" />
            {/* band */}
            <path d="M30 100 H66" stroke="#c9c9c9" strokeWidth="3" />
            {/* window */}
            <circle cx="48" cy="76" r="9.5" fill="#0a0a0a" />
            <circle cx="48" cy="76" r="6.5" fill="#f5f5f5" />
            {/* nozzle */}
            <path d="M36 140 H60 L64 154 H32 Z" fill="#3a3a3a" />
            <path d="M36 140 H60" stroke="#6b6b6b" strokeWidth="1.5" />
          </svg>
          <div className="noxara-launch-flame" />
          <div className="noxara-launch-flame-core" />
          {PARTICLE_LAYOUT.map((p, i) => (
            <span
              key={i}
              className="noxara-launch-particle"
              style={{ left: p.left, "--px": p.drift, animationDelay: p.delay } as CSSProperties}
            />
          ))}
        </div>
        <div className="noxara-launch-label">
          <span className="noxara-launch-name">{active?.title ?? "Noxara"}</span>
          <span className="noxara-launch-status">
            {active?.description ?? (state.phase === "exit" ? "Launching complete" : "Launching Minecraft…")}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Reads the current launch-store snapshot imperatively (used after animation timers). */
function snapshot(): RocketInput {
  const s = useLaunchStore.getState();
  return {
    launching: s.launchingInstanceIds,
    running: s.runningInstanceIds,
    crashed: s.crashedInstanceIds,
    errored: s.errorInstanceIds,
  };
}