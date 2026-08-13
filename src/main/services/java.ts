import { randomUUID } from "node:crypto";
import { coreBridge, type CoreBridgeError } from "./core-bridge";
import { javaDir } from "../filesystem/paths";
import { startActivity, updateActivity, succeedActivity, failActivity } from "./activity";
import type { JavaInstallation } from "../../shared/types/ipc";

interface RustJavaInstallation {
  path: string;
  version: string;
  major_version: number;
  vendor: string | null;
  is_64bit: boolean;
}

function toCamel(r: RustJavaInstallation): JavaInstallation {
  return {
    path: r.path,
    version: r.version,
    majorVersion: r.major_version,
    vendor: r.vendor,
    is64bit: r.is_64bit,
  };
}

export async function detectJava(): Promise<JavaInstallation[]> {
  const results = await coreBridge.call<RustJavaInstallation[]>("java.detectAll");
  return results.map(toCamel);
}

export async function testJavaPath(path: string): Promise<JavaInstallation | null> {
  const result = await coreBridge.call<RustJavaInstallation | null>("java.testPath", { path });
  return result ? toCamel(result) : null;
}

/** Result shape returned by noxara-core's `java.ensureRuntime`. */
export interface RuntimeInstallResult {
  path: string;
  component: string;
  majorVersion: number;
  downloaded: boolean;
}

/**
 * Downloads/installs Mojang's official bundled Java runtime for the given major
 * version into the launcher's managed Java directory and returns the java
 * executable path. `component` is the exact `javaVersion.component` from the
 * version JSON when known (e.g. "java-runtime-21"); pass "" to let the core pick
 * the best runtime for `majorVersion`. Progress events stream under `taskId`.
 */
export async function ensureJavaRuntime(
  component: string,
  majorVersion: number,
  taskId: string
): Promise<string> {
  const result = await coreBridge.call<RuntimeInstallResult>(
    "java.ensureRuntime",
    { component, majorVersion, destDir: javaDir(), taskId },
    10 * 60 * 1000 // a JRE archive can be ~100MB on a slow connection
  );
  return result.path;
}

/** User-facing variant used by the Java manager: reports real progress through the
 * global activity system and returns the detected installation once done. */
export async function installJavaRuntime(majorVersion: number): Promise<JavaInstallation> {
  const activityId = randomUUID();
  startActivity(activityId, {
    type: "java",
    title: `Java ${majorVersion}`,
    description: "Downloading Mojang's official runtime",
    status: "downloading",
    control: {
      cancel: async () => {
        await coreBridge.call("downloads.cancel", { taskId: activityId }).catch(() => undefined);
      },
    },
  });
  updateActivity(activityId, { cancellable: true });
  try {
    const path = await ensureJavaRuntime("", majorVersion, activityId);
    const install = await testJavaPath(path);
    if (!install) {
      throw new Error("Java runtime was installed but could not be verified.");
    }
    succeedActivity(activityId, {
      description: `Installed Java ${install.majorVersion} (${install.version})`,
    });
    return install;
  } catch (err) {
    if (!(err instanceof Error && (err as CoreBridgeError).code === "cancelled")) {
      failActivity(activityId, err instanceof Error ? err.message : "Java download failed");
    }
    throw err;
  }
}