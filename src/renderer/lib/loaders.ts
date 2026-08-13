import type {
  FabricLoaderVersion,
  ForgeVersion,
  NeoForgeVersion,
  QuiltLoaderVersion,
} from "@shared/types/ipc";

/**
 * Unified loader registry. Every place the UI deals with mod loaders (the create
 * wizard's version picker, compatibility filters) reads loader metadata and fetches
 * real published builds through these helpers instead of duplicating per-loader
 * switch statements with hardcoded labels.
 */
export type LoaderId = "vanilla" | "fabric" | "forge" | "neoforge" | "quilt";

export interface LoaderDefinition {
  id: LoaderId;
  /** Display name, e.g. "Fabric", "NeoForge". */
  name: string;
  /** One-line description shown next to the loader picker. */
  description: string;
}

export interface LoaderVersionOption {
  /** The value stored on the instance (Fabric/Quilt loader build, Forge/NeoForge full "<mc>-<loader>" version). */
  version: string;
  /** What to show in the picker (Forge/NeoForge show just the build number). */
  display: string;
  /** Optional badge: "Recommended" / "Latest". */
  tag: string;
}

export const LOADERS: LoaderDefinition[] = [
  { id: "vanilla", name: "Vanilla", description: "Runs unmodified Minecraft." },
  { id: "fabric", name: "Fabric", description: "Lightweight modding framework." },
  { id: "forge", name: "Forge", description: "Classic modding API with the largest mod catalog." },
  { id: "neoforge", name: "NeoForge", description: "Modern fork of Forge, actively developed." },
  { id: "quilt", name: "Quilt", description: "Fabric-compatible loader built for the community." },
];

export function loaderDefinition(id: LoaderId): LoaderDefinition {
  return LOADERS.find((l) => l.id === id) ?? { id, name: id, description: "" };
}

export function loaderDisplayName(id: string): string {
  if (id === "vanilla") return "Vanilla";
  return loaderDefinition(id as LoaderId).name;
}

/** Normalizes loader "version" records into the uniform picker shape. */
export function normalizeLoaderVersions(
  loader: Exclude<LoaderId, "vanilla">,
  list: Array<ForgeVersion | NeoForgeVersion | FabricLoaderVersion | QuiltLoaderVersion>
): LoaderVersionOption[] {
  if (loader === "forge" || loader === "neoforge") {
    return (list as Array<ForgeVersion | NeoForgeVersion>).map((v) => ({
      version: v.fullVersion,
      display: v.forgeVersion,
      tag: v.recommended ? "Recommended" : v.latest ? "Latest" : "",
    }));
  }
  return (list as Array<FabricLoaderVersion | QuiltLoaderVersion>).map((v) => ({
    version: v.version,
    display: v.version,
    tag: v.stable ? "Recommended" : "",
  }));
}

/** Prefers the tagged "Recommended" build (the safe pick), then "Latest", falling
 * back to the first listed build. */
export function preferredLoaderVersion(options: LoaderVersionOption[]): string | null {
  return (
    options.find((v) => v.tag === "Recommended")?.version ??
    options.find((v) => v.tag === "Latest")?.version ??
    options[0]?.version ??
    null
  );
}

/** Fetches the currently-published loader builds for a Minecraft version through the
 * core (never hardcoded). Rejects with the underlying core error so callers can
 * surface a Retry. */
export async function fetchLoaderVersions(
  loader: Exclude<LoaderId, "vanilla">,
  minecraftVersion: string
): Promise<LoaderVersionOption[]> {
  let list: unknown;
  switch (loader) {
    case "fabric":
      list = await window.noxara.getFabricLoaderVersions(minecraftVersion);
      break;
    case "quilt":
      list = await window.noxara.getQuiltLoaderVersions(minecraftVersion);
      break;
    case "forge":
      list = await window.noxara.getForgeVersions(minecraftVersion);
      break;
    case "neoforge":
      list = await window.noxara.getNeoForgeVersions(minecraftVersion);
      break;
  }
  return normalizeLoaderVersions(loader, list as Array<ForgeVersion | NeoForgeVersion | FabricLoaderVersion | QuiltLoaderVersion>);
}
