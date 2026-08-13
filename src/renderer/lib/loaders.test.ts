import { describe, it, expect } from "vitest";
import { LOADERS, normalizeLoaderVersions, preferredLoaderVersion } from "./loaders";
import type { FabricLoaderVersion, ForgeVersion, QuiltLoaderVersion } from "@shared/types/ipc";

describe("loader registry", () => {
  it("defines exactly the five supported loaders in a stable order", () => {
    expect(LOADERS.map((l) => l.id)).toEqual(["vanilla", "fabric", "forge", "neoforge", "quilt"]);
    expect(LOADERS.map((l) => l.name)).toEqual(["Vanilla", "Fabric", "Forge", "NeoForge", "Quilt"]);
  });
});

describe("normalizeLoaderVersions", () => {
  it("normalizes Fabric-style records, tagging stable builds as recommended", () => {
    const list: FabricLoaderVersion[] = [
      { version: "0.14.24", stable: true, build: 1, maven: "https://maven.fabricmc.net/" },
      { version: "0.15.11", stable: false, build: 2, maven: "https://maven.fabricmc.net/" },
    ];
    const opts = normalizeLoaderVersions("fabric", list);
    expect(opts[0]).toMatchObject({ version: "0.14.24", display: "0.14.24", tag: "Recommended" });
    expect(opts[1]).toMatchObject({ version: "0.15.11", tag: "" });
  });

  it("normalizes Forge-style records to their full <mc>-<loader> version", () => {
    const list: ForgeVersion[] = [
      { minecraftVersion: "1.21.1", forgeVersion: "52.0.1", fullVersion: "1.21.1-52.0.1", recommended: true, latest: false },
      { minecraftVersion: "1.21.1", forgeVersion: "52.1.0", fullVersion: "1.21.1-52.1.0", recommended: false, latest: true },
    ];
    const opts = normalizeLoaderVersions("forge", list);
    expect(opts[0]).toMatchObject({ version: "1.21.1-52.0.1", display: "52.0.1", tag: "Recommended" });
    expect(opts[1]).toMatchObject({ version: "1.21.1-52.1.0", display: "52.1.0", tag: "Latest" });
  });
});

describe("preferredLoaderVersion", () => {
  it("prefers the Recommended build over the Latest", () => {
    const opts = [
      { version: "1.21.1-52.1.0", display: "52.1.0", tag: "Latest" },
      { version: "1.21.1-52.0.1", display: "52.0.1", tag: "Recommended" },
    ];
    expect(preferredLoaderVersion(opts)).toBe("1.21.1-52.0.1");
  });

  it("falls back to the first listed build when no build is tagged", () => {
    const opts = normalizeLoaderVersions("quilt", [
      { version: "0.25.2", stable: false, build: 1, maven: "https://quiltmc.org/" } as QuiltLoaderVersion,
    ]);
    expect(preferredLoaderVersion(opts)).toBe("0.25.2");
  });

  it("returns null for an empty list", () => {
    expect(preferredLoaderVersion([])).toBeNull();
  });
});