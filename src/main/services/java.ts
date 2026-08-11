import { coreBridge } from "./core-bridge";
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
