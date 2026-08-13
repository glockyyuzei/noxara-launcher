/**
 * Instance health + repair.
 *
 * checkInstanceHealth(instanceId) runs real, local-first checks against what's on
 * disk (client jar, loader install marker, Java runtime, installed mod files,
 * missing required Modrinth dependencies, available updates) and produces a single
 * status: healthy / attention / broken. Nothing here invents progress — every check
 * reads actual state.
 *
 * repairInstance(instanceId) drives an activity-driven repair: re-downloads the
 * Minecraft client + libraries + assets (via the same game-files module launch
 * uses, so the batch events feed the activity), re-fetches any installed mod whose
 * file went missing, and auto-installs missing required dependencies.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { coreBridge, type CoreBridgeError } from "./core-bridge";
import { getInstanceDirById, listInstances } from "./instances";
import { getSettings } from "./settings";
import { detectJava } from "./java";
import { versionsDir, librariesDir } from "../filesystem/paths";
import { ensureVersionAssetsAndLibraries } from "./game-files";
import { getFabricVersionDetail } from "./fabric";
import { getQuiltVersionDetail } from "./quilt";
import { listInstalledMods, getModDependencies, redownloadMissingModFiles, installMissingDependencies } from "./mods";
import { checkModUpdates } from "./mods";
import { startActivity, updateActivity, progressActivity, succeedActivity, failActivity } from "./activity";
import type {
  InstanceHealthCheck,
  InstanceHealthReport,
  InstanceHealthStatus,
} from "../../shared/types/ipc";

type VersionDetail = any;

interface HealthCheckBuilder {
  checks: InstanceHealthCheck[];
  add(check: InstanceHealthCheck): void;
  status(): InstanceHealthStatus;
}

function checkBuilder(): HealthCheckBuilder {
  const checks: InstanceHealthCheck[] = [];
  return {
    checks,
    add(check) {
      checks.push(check);
    },
    status() {
      if (checks.some((c) => c.status === "error")) return "broken";
      if (checks.some((c) => c.status === "warning")) return "attention";
      return "healthy";
    },
  };
}

/** The version id whose client jar actually lands in versionsDir for this instance.
 * For vanilla it's the Minecraft version; for fabric/quilt the loader profile's own
 * id; for forge/neoforge the vanilla client jar is the one the installer patches. */
async function resolveDetailFor(mcVersion: string, loader: string, loaderVersion: string | null) {
  const { detail: vanillaDetail, recommendedJavaMajor } = await coreBridge.call<{
    detail: VersionDetail;
    recommendedJavaMajor: number;
  }>("mojang.getVersionDetail", { versionId: mcVersion });

  let detail: VersionDetail = vanillaDetail;
  if (loader === "fabric") {
    ({ detail } = await getFabricVersionDetail(mcVersion, loaderVersion!));
  } else if (loader === "quilt") {
    ({ detail } = await getQuiltVersionDetail(mcVersion, loaderVersion!));
  }
  return { detail, recommendedJavaMajor };
}

async function javaAvailable(instanceJavaPath: string | null): Promise<{ ok: boolean; detail: string }> {
  if (instanceJavaPath) {
    return fs.existsSync(instanceJavaPath)
      ? { ok: true, detail: instanceJavaPath }
      : { ok: false, detail: `Configured Java not found: ${instanceJavaPath}` };
  }
  const settings = getSettings();
  if (!settings.autoDetectJava && settings.defaultJavaPath) {
    return fs.existsSync(settings.defaultJavaPath)
      ? { ok: true, detail: settings.defaultJavaPath }
      : { ok: false, detail: `Default Java not found: ${settings.defaultJavaPath}` };
  }
  try {
    const installs = await detectJava();
    if (installs.length === 0) {
      return { ok: false, detail: "No Java runtime detected on this system." };
    }
    return { ok: true, detail: installs[0].path };
  } catch {
    return { ok: false, detail: "Java detection failed." };
  }
}

/** Bounded online dependency + update scan for a health report. Checks the first
 * N installed Modrinth mods so the report stays fast on large packs. */
async function modDependencyScan(instanceId: string): Promise<{ missing: number; outdated: number; errors: string[] }> {
  const SCAN_CAP = 15;
  const installed = listInstalledMods(instanceId).filter(
    (m) => m.source === "modrinth" && m.sourceId && m.sourceVersionId
  );
  const scanned = installed.slice(0, SCAN_CAP);
  const missingProjects = new Set<string>();
  const errors: string[] = [];

  for (const mod of scanned) {
    try {
      const deps = await getModDependencies(instanceId, mod.sourceVersionId!);
      for (const dep of deps.missing) missingProjects.add(dep.projectId);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "scan error");
    }
  }

  let outdated = 0;
  try {
    outdated = (await checkModUpdates(instanceId)).length;
  } catch {
    // Update check is best-effort; a failure here must not fail the health report.
  }

  return { missing: missingProjects.size, outdated, errors };
}

export async function checkInstanceHealth(instanceId: string): Promise<InstanceHealthReport> {
  const builder = checkBuilder();
  const instance = listInstances().find((i) => i.id === instanceId);
  if (!instance) {
    return {
      status: "broken",
      checks: [{ id: "instance", label: "Instance", status: "error", detail: "Instance not found" }],
    };
  }

  const dir = getInstanceDirById(instanceId);
  builder.add({
    id: "dir",
    label: "Instance folder",
    status: fs.existsSync(dir) ? "ok" : "error",
    detail: dir,
  });

  // Client files. Forge/NeoForge only need the vanilla jar (the installer patches
  // it on first launch); the loader-install marker check below covers their state.
  try {
    const { detail, recommendedJavaMajor } = await resolveDetailFor(instance.minecraftVersion, instance.loader, instance.loaderVersion);

    const clientJar = path.join(versionsDir(), `${detail.id}.jar`);
    const jarOk = fs.existsSync(clientJar) && fs.statSync(clientJar).size > 0;
    builder.add({
      id: "client",
      label: "Minecraft client",
      status: jarOk ? "ok" : "error",
      detail: jarOk ? `Client jar present (${detail.id})` : "Client jar missing — Repair will re-download it.",
    });

    if (instance.loader === "fabric" || instance.loader === "quilt") {
      const jsonOk = fs.existsSync(path.join(versionsDir(), `${detail.id}.json`));
      builder.add({
        id: "loader-json",
        label: `${instance.loader === "fabric" ? "Fabric" : "Quilt"} profile`,
        status: jsonOk ? "ok" : "warning",
        detail: jsonOk ? "Profile json cached" : "Profile json not cached — it's fetched at launch (no action needed).",
      });
    }

    // Java: recommended major for this version vs. what's actually configured/found.
    const java = await javaAvailable(instance.javaPath);
    builder.add({
      id: "java",
      label: "Java runtime",
      status: java.ok ? "ok" : "error",
      detail: java.ok ? java.detail : `${java.detail} Open Java Manager to fix it.`,
    });
    builder.checks[builder.checks.length - 1].detail = `${java.detail}${
      java.ok && recommendedJavaMajor ? ` (needs Java ${recommendedJavaMajor}+)` : ""
    }`;
  } catch (err) {
    builder.add({
      id: "client",
      label: "Minecraft client",
      status: "error",
      detail: `Couldn't resolve version files: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  if (instance.loader === "forge" || instance.loader === "neoforge") {
    const fullVersion = instance.loaderVersion;
    const marker = path.join(librariesDir(), ".forge-installed", `${fullVersion}.json`);
    const markerOk = fs.existsSync(marker);
    builder.add({
      id: "loader",
      label: instance.loader === "forge" ? "Forge install" : "NeoForge install",
      status: markerOk ? "ok" : "warning",
      detail: markerOk
        ? "Loader install present"
        : "Not installed yet — it will be installed on first launch (no action needed).",
    });
  }

  // Mods on disk.
  const installedMods = listInstalledMods(instanceId);
  const missingMods = installedMods.filter((m) => !m.fileExists);
  builder.add({
    id: "mods",
    label: "Mod files",
    status: missingMods.length === 0 ? "ok" : "warning",
    detail:
      missingMods.length === 0
        ? `${installedMods.length} mod${installedMods.length === 1 ? "" : "s"} present`
        : `${missingMods.length} mod file${missingMods.length === 1 ? " is" : "s are"} missing — Repair will re-download.`,
  });

  // Online dependency + update scan (bounded, best-effort).
  try {
    const scan = await modDependencyScan(instanceId);
    builder.add({
      id: "deps",
      label: "Required dependencies",
      status: scan.missing === 0 ? "ok" : "error",
      detail:
        scan.missing === 0
          ? "All required dependencies installed"
          : `${scan.missing} required dependenc${scan.missing === 1 ? "y is" : "ies are"} missing — Repair will install.`,
    });
    if (scan.outdated > 0) {
      builder.add({
        id: "updates",
        label: "Available updates",
        status: "warning",
        detail: `${scan.outdated} mod${scan.outdated === 1 ? "" : "s"} have updates available.`,
      });
    }
  } catch {
    builder.add({
      id: "deps",
      label: "Required dependencies",
      status: "warning",
      detail: "Couldn't verify dependencies (network).",
    });
  }

  return { status: builder.status(), checks: builder.checks };
}

export async function repairInstance(instanceId: string): Promise<InstanceHealthReport> {
  const instance = listInstances().find((i) => i.id === instanceId);
  if (!instance) throw new Error(`instance ${instanceId} not found`);

  const activityId = randomUUID();
  startActivity(activityId, {
    type: "instance",
    title: instance.name,
    instanceId: instance.id,
    description: "Repairing instance",
    status: "repairing",
    control: {
      cancel: async () => {
        await coreBridge.call("downloads.cancel", { taskId: activityId }).catch(() => undefined);
      },
    },
  });
  updateActivity(activityId, { cancellable: true });

  try {
    // 1. Re-download client + libraries + assets (batch events feed the activity).
    progressActivity(activityId, {}, "repairing", { description: "Downloading Minecraft files" });
    const { detail } = await resolveDetailFor(instance.minecraftVersion, instance.loader, instance.loaderVersion);
    await ensureVersionAssetsAndLibraries(detail, path.join(getInstanceDirById(instanceId), "natives"), activityId);

    // 2. Re-fetch installed mods whose files went missing.
    progressActivity(activityId, {}, "repairing", { description: "Restoring mod files" });
    const restored = await redownloadMissingModFiles(instanceId, activityId);

    // 3. Auto-install missing required dependencies.
    progressActivity(activityId, {}, "repairing", { description: "Installing dependencies" });
    const depsInstalled = await installMissingDependencies(instanceId, activityId);

    const repaired = [];
    if (restored > 0) repaired.push(`${restored} mod file${restored === 1 ? "" : "s"}`);
    if (depsInstalled > 0) repaired.push(`${depsInstalled} dependenc${depsInstalled === 1 ? "y" : "ies"}`);
    succeedActivity(activityId, {
      description:
        repaired.length > 0
          ? `Repair finished (${repaired.join(", ")})`
          : "Repair finished — everything was already in place",
    });
  } catch (err) {
    if (!(err instanceof Error && (err as CoreBridgeError).code === "cancelled")) {
      failActivity(activityId, err instanceof Error ? err.message : "Repair failed");
    }
    throw err;
  }

  return checkInstanceHealth(instanceId);
}