/**
 * Rich Presence controller: translates the real Noxara/Minecraft lifecycle into the
 * activity shown on Discord. This is the ONLY module that decides what presence to
 * push — the renderer never talks to Discord directly.
 *
 * The lifecycle is the single source of truth, exactly like the rocket animation:
 *   Noxara starts            -> launcher presence
 *   user launches an instance -> "Launching Minecraft"
 *   core reports game.started -> "Playing Minecraft" (elapsed timer from that moment)
 *   core reports game.exit    -> back to launcher presence
 *
 * When several instances run at once we show the most recently started running one, so
 * concurrent sessions can't fight over the activity. Everything here is best-effort and
 * never throws: if Discord is missing, disabled, or disconnected, the controller just
 * keeps the state bookkeeping and silently skips the network calls.
 */
import { discordRpc, type DiscordActivity } from "./discord-rpc";

/** The slice of the Discord client the controller needs — injected so tests can use a
 * fake instead of touching a real socket. */
export interface PresenceTarget {
  setEnabled(enabled: boolean): void;
  setActivity(activity: DiscordActivity): void;
}

/** Non-secret info we already know about a launch, used to describe it on Discord. */
export interface LaunchSessionInfo {
  instanceName: string;
  minecraftVersion: string;
  loader: string;
  /** Resolved from the `--server` game arg when the user joined a server on launch. */
  server?: string;
}

interface RunningSession {
  instanceId: string;
  info: LaunchSessionInfo;
  /** Epoch ms the JVM actually came up (game.started) — the real session start. */
  startedAt: number;
}

/** Discord application asset key for the large image. Documented in the README. */
const NOXARA_ASSET = "noxara_logo";

export class PresenceController {
  private enabled = false;
  private launching: { instanceId: string; info: LaunchSessionInfo } | null = null;
  private sessions = new Map<string, RunningSession>();

  constructor(private target: PresenceTarget = discordRpc) {}

  /** Enables presence and immediately pushes whatever activity is correct now. */
  start(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.target.setEnabled(true);
    this.refresh();
  }

  /** Disables presence and drops the Discord connection (presence clears on the pipe
   * closing). Session bookkeeping survives so re-enabling restores the right state. */
  stop(): void {
    this.enabled = false;
    this.target.setEnabled(false);
  }

  /** A real launch pipeline started for an instance. */
  onLaunchStart(instanceId: string, info: LaunchSessionInfo): void {
    this.launching = { instanceId, info };
    this.refresh();
  }

  /** The launch pipeline failed before the JVM ever came up. */
  onLaunchFailed(instanceId: string): void {
    if (this.launching?.instanceId === instanceId) {
      this.launching = null;
      this.refresh();
    }
  }

  /** The core reported the Minecraft JVM actually started. */
  onGameStarted(instanceId: string): void {
    const info =
      this.launching?.instanceId === instanceId
        ? this.launching.info
        : this.sessions.get(instanceId)?.info;
    if (this.launching?.instanceId === instanceId) this.launching = null;
    this.sessions.set(instanceId, {
      instanceId,
      info: info ?? { instanceName: "Minecraft", minecraftVersion: "", loader: "" },
      startedAt: Date.now(),
    });
    this.refresh();
  }

  /** Minecraft exited — return to the launcher presence (or another running session). */
  onGameExited(instanceId: string): void {
    this.sessions.delete(instanceId);
    if (this.launching?.instanceId === instanceId) this.launching = null;
    this.refresh();
  }

  private refresh(): void {
    if (!this.enabled) return;
    const activity = this.computeActivity();
    if (!activity) return;
    this.target.setActivity(activity);
  }

  private computeActivity(): DiscordActivity | null {
    if (this.launching) return this.launchingActivity(this.launching);
    const running = [...this.sessions.values()].sort((a, b) => b.startedAt - a.startedAt);
    if (running.length > 0) return this.playingActivity(running[0]);
    return this.launcherActivity();
  }

  private launcherActivity(): DiscordActivity {
    return {
      details: "Managing Minecraft instances",
      state: "Minecraft Launcher",
      largeImage: NOXARA_ASSET,
      largeText: "Noxara Launcher",
    };
  }

  private launchingActivity(launch: { instanceId: string; info: LaunchSessionInfo }): DiscordActivity {
    return {
      details: "Launching Minecraft",
      state: launch.info.instanceName,
      largeImage: NOXARA_ASSET,
      largeText: "Noxara Launcher",
    };
  }

  private playingActivity(session: RunningSession): DiscordActivity {
    const { info } = session;
    if (info.server) {
      return {
        details: "Playing Minecraft",
        state: `Playing on ${info.server}`,
        start: session.startedAt,
        largeImage: NOXARA_ASSET,
        largeText: "Noxara Launcher",
      };
    }
    return {
      details: "Playing Minecraft",
      state: "Singleplayer",
      start: session.startedAt,
      largeImage: NOXARA_ASSET,
      largeText: "Noxara Launcher",
    };
  }
}

export const presence = new PresenceController();

/** Parses the `--server` address out of the extra game args the renderer passes on a
 * server launch (ServersPage appends `--server <address> [--port <port>]`). Returns
 * undefined when the user launched plain singleplayer. */
export function extractServerAddress(extraGameArgs?: string[]): string | undefined {
  if (!extraGameArgs) return undefined;
  const index = extraGameArgs.indexOf("--server");
  const address = index >= 0 ? extraGameArgs[index + 1] : undefined;
  return address && address.trim() ? address.trim() : undefined;
}