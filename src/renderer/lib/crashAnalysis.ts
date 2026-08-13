import type { CrashInfo } from "@shared/types/ipc";
import type { ConsoleLine } from "../stores/useLaunchStore";

/**
 * Deterministic crash diagnosis from the game's own console output (and exit code).
 * Pure renderer function: given the last chunk of an instance's log plus the process
 * exit code the core reported, it returns a user-facing CrashInfo.
 *
 * Matching is greedy — the first recognized pattern wins, so a JVM-init failure that
 * also contains an OutOfMemoryError is reported as the JVM init problem (the one the
 * user actually needs to fix to get the game to start at all).
 */
export function analyzeCrash(lines: ConsoleLine[], exitCode: number | null): CrashInfo {
  const text = lines
    .slice(-400)
    .map((l) => l.line)
    .join("\n");
  const occurredAt = new Date().toISOString();

  const match = (re: RegExp): string | null => {
    const hit = re.exec(text);
    return hit ? (hit[0].slice(0, 200) ?? null) : null;
  };

  const jvmInit = match(/Could not create the Java Virtual Machine/i);
  if (jvmInit) {
    return {
      exitCode,
      reason: "Java could not start (the JVM itself refused to launch).",
      hint: "Lower the allocated RAM in the instance's Java settings — this usually means the memory limit is too large for this computer.",
      patternId: "jvm_init_failed",
      detail: jvmInit,
      occurredAt,
    };
  }

  const oom = match(/OutOfMemoryError/);
  if (oom) {
    return {
      exitCode,
      reason: "The game ran out of memory.",
      hint: "Increase the allocated RAM in the instance's Java settings, or install fewer memory-heavy mods.",
      patternId: "out_of_memory",
      detail: oom,
      occurredAt,
    };
  }

  const classVersion = match(/UnsupportedClassVersionError/);
  if (classVersion) {
    return {
      exitCode,
      reason: "A mod or dependency was compiled for a newer Java than the one running the game.",
      hint: "Install the Java version this Minecraft version requires (Java page), or remove the offending mod.",
      patternId: "java_too_old",
      detail: classVersion,
      occurredAt,
    };
  }

  const missingClass = match(/(?:NoClassDefFoundError|ClassNotFoundException)/);
  if (missingClass) {
    return {
      exitCode,
      reason: "A mod is missing a class/dependency it requires.",
      hint: "Check the mod's page for required dependencies and install them, then try again.",
      patternId: "missing_dependency",
      detail: missingClass,
      occurredAt,
    };
  }

  const duplicateMods = match(/DuplicateModsFoundException/);
  if (duplicateMods) {
    return {
      exitCode,
      reason: "Two copies of the same mod are present.",
      hint: "Remove the duplicate mod(s) from the instance's mods folder and try again.",
      patternId: "duplicate_mods",
      detail: duplicateMods,
      occurredAt,
    };
  }

  const modResolution = match(/ModResolutionException|Couldn't resolve.*mod|Missing.*dependencies?/i);
  if (modResolution) {
    return {
      exitCode,
      reason: "A mod couldn't be resolved — a dependency is missing, mismatched, or incompatible.",
      hint: "Open the Mods page and check the dependency/incompatibility notes, or remove the offending mod.",
      patternId: "missing_dependencies",
      detail: modResolution,
      occurredAt,
    };
  }

  const incompatible = match(/NoSuchMethodError|NoSuchFieldError|IncompatibleClassChangeError/);
  if (incompatible) {
    return {
      exitCode,
      reason: "A mod expects an API version the installed loaders don't provide.",
      hint: "Update the mod, or remove it and relaunch — a mod/game version mismatch is the usual cause.",
      patternId: "mod_incompatibility",
      detail: incompatible,
      occurredAt,
    };
  }

  const network = match(/(?:ConnectException|UnknownHostException|SocketException|Connection refused)/);
  if (network) {
    return {
      exitCode,
      reason: "The game lost its network connection during startup.",
      hint: "Check your internet connection and try again.",
      patternId: "network",
      detail: network,
      occurredAt,
    };
  }

  return {
    exitCode,
    reason: exitCode !== null ? `Minecraft stopped unexpectedly (exit code ${exitCode}).` : "Minecraft stopped unexpectedly.",
    hint: "Check the console for the full error, or run a health check / repair from the instance page.",
    patternId: "generic",
    occurredAt,
  };
}
