import { describe, it, expect } from "vitest";
import { pickLatestFabricLoaderVersion, fabricUnsupportedError } from "./fabric";
import { pickLatestQuiltLoaderVersion, quiltUnsupportedError } from "./quilt";
import type { FabricLoaderVersion, QuiltLoaderVersion } from "../../shared/types/ipc";

function fabricV(version: string, stable: boolean): FabricLoaderVersion {
  return { version, stable, build: null, maven: `net.fabricmc:fabric-loader:${version}` };
}

function quiltV(version: string, stable: boolean): QuiltLoaderVersion {
  return { version, stable, build: null, maven: `org.quiltmc:quilt-loader:${version}` };
}

describe("pickLatestFabricLoaderVersion", () => {
  it("returns null when there are no loader builds", () => {
    expect(pickLatestFabricLoaderVersion([])).toBeNull();
  });

  it("prefers the newest stable build over newer unstable ones", () => {
    const versions = [fabricV("0.16.5", true), fabricV("0.16.7", false), fabricV("0.16.9", false)];
    expect(pickLatestFabricLoaderVersion(versions)).toBe("0.16.5");
  });

  it("falls back to the first listed build when nothing is stable yet (API lists newest first)", () => {
    const versions = [fabricV("0.17.1", false), fabricV("0.17.0", false)];
    expect(pickLatestFabricLoaderVersion(versions)).toBe("0.17.1");
  });

  it("picks the only entry when a single build exists", () => {
    expect(pickLatestFabricLoaderVersion([fabricV("0.15.0", true)])).toBe("0.15.0");
  });
});

describe("fabricUnsupportedError", () => {
  it("is an Error that names the unsupported Minecraft version", () => {
    const err = fabricUnsupportedError("1.7.2");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("1.7.2");
    expect(err.message).toContain("Fabric");
  });
});

describe("pickLatestQuiltLoaderVersion", () => {
  it("returns null when there are no loader builds", () => {
    expect(pickLatestQuiltLoaderVersion([])).toBeNull();
  });

  it("prefers the newest stable build over newer unstable ones", () => {
    const versions = [quiltV("0.27.0", true), quiltV("0.27.5", false)];
    expect(pickLatestQuiltLoaderVersion(versions)).toBe("0.27.0");
  });

  it("falls back to the first listed build when nothing is stable yet (API lists newest first)", () => {
    const versions = [quiltV("0.28.1", false), quiltV("0.28.0", false)];
    expect(pickLatestQuiltLoaderVersion(versions)).toBe("0.28.1");
  });

  it("picks the only entry when a single build exists", () => {
    expect(pickLatestQuiltLoaderVersion([quiltV("0.26.1", true)])).toBe("0.26.1");
  });
});

describe("quiltUnsupportedError", () => {
  it("is an Error that names the unsupported Minecraft version", () => {
    const err = quiltUnsupportedError("1.7.2");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("1.7.2");
    expect(err.message).toContain("Quilt");
  });
});