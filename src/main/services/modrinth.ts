/**
 * Thin client for the official Modrinth API (https://api.modrinth.com/v2).
 * Main-process only — the renderer never makes network calls directly, per the
 * existing preload/IPC security model. No caching layer beyond a short in-memory
 * TTL cache to avoid hammering the API while the user types in the search box.
 */
import type {
  ModEnvironment,
  ModLoader,
  ModrinthCategory,
  ModrinthSearchHit,
  ModrinthSearchResult,
  ModrinthVersion,
  ModSearchQuery,
} from "../../shared/types/ipc";
import { fetchWithRetry } from "./http";

const API_BASE = "https://api.modrinth.com/v2";
const USER_AGENT = "NoxaraLauncher/0.1.0 (https://github.com/noxara-labs/noxara-launcher)";

/** Modrinth is behind rate limits and occasionally throws 429/5xx under load. The
 * shared retry helper honors Retry-After, backs off on 5xx, and caps each attempt so
 * a hung API never blocks the UI. All retries are safe: these are read-only GETs. */
async function modrinthFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }
  const res = await fetchWithRetry(url, { headers: { "User-Agent": USER_AGENT } }, { maxAttempts: 3 });
  if (!res.ok) {
    // Distinguish "slow down" from "gone wrong" so the user sees actionable text.
    if (res.status === 429) {
      throw new Error("Modrinth is rate-limiting requests right now. Wait a moment and try again.");
    }
    if (res.status >= 500) {
      throw new Error("Modrinth is having trouble right now (server error). Please try again shortly.");
    }
    if (res.status === 404) {
      throw new Error("The requested Modrinth project or version no longer exists.");
    }
    throw new Error(`Modrinth API error (${res.status}): ${res.statusText}`);
  }
  return (await res.json()) as T;
}

interface ModrinthSearchHitRaw {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  icon_url: string | null;
  downloads: number;
  follows: number;
  categories: string[];
  display_categories: string[];
  versions: string[];
  latest_version: string;
  project_type: string;
}

interface ModrinthSearchResponseRaw {
  hits: ModrinthSearchHitRaw[];
  total_hits: number;
  offset: number;
  limit: number;
}

const SORT_MAP: Record<NonNullable<ModSearchQuery["sort"]>, string> = {
  relevance: "relevance",
  downloads: "downloads",
  newest: "newest",
  updated: "updated",
};

/** Environment filters map onto Modrinth's client_side/server_side facets. Each array
 * is OR'd internally and AND'd across arrays, so "both" requires client_side AND
 * server_side compatibility, while "client"/"server" require only the one side. */
function environmentFacets(environment: ModEnvironment | undefined): string[][] {
  if (!environment || environment === "all") return [];
  if (environment === "client") return [["client_side:required", "client_side:optional"]];
  if (environment === "server") return [["server_side:required", "server_side:optional"]];
  return [
    ["client_side:required", "client_side:optional"],
    ["server_side:required", "server_side:optional"],
  ];
}

/** Builds Modrinth's facet string (OR within each array, AND across arrays). Exported
 * for tests — the renderer can never call this directly. */
export function buildFacets(
  projectType: string,
  loader?: ModLoader,
  gameVersion?: string,
  category?: string,
  environment?: ModEnvironment
): string {
  const facets: string[][] = [[`project_type:${projectType}`]];
  if (loader) facets.push([`categories:${loader}`]);
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  if (category) facets.push([`categories:${category}`]);
  facets.push(...environmentFacets(environment));
  return JSON.stringify(facets);
}

/** The Modrinth category list for mods, used to build the browse filters. */
export async function getModCategories(): Promise<ModrinthCategory[]> {
  const raw = await modrinthFetch<Array<{ name: string; slug: string; icon: string }>>("/tag/category", {
    project_type: "mod",
  });
  return raw.map((c) => ({ name: c.name, slug: c.slug, icon: c.icon }));
}

export async function searchMods(query: ModSearchQuery): Promise<ModrinthSearchResult> {
  const projectType = query.projectType ?? "mod";
  const raw = await modrinthFetch<ModrinthSearchResponseRaw>("/search", {
    query: query.query ?? "",
    facets: buildFacets(projectType, query.loader, query.gameVersion, query.category, query.environment),
    index: SORT_MAP[query.sort ?? "relevance"],
    offset: String(query.offset ?? 0),
    limit: String(query.limit ?? 20),
  });

  // Same exact-match tagging quirk as getProjectVersions below: a project can be
  // genuinely compatible with a Minecraft version its listed hits just never got
  // explicitly tagged for. Rather than showing zero results for a real search, widen
  // to loader-only and let the version-selection step (which already does its own
  // fallback) sort out real compatibility per-project.
  if (raw.hits.length === 0 && query.gameVersion) {
    const widened = await modrinthFetch<ModrinthSearchResponseRaw>("/search", {
      query: query.query ?? "",
      facets: buildFacets(projectType, query.loader, undefined, query.category, query.environment),
      index: SORT_MAP[query.sort ?? "relevance"],
      offset: String(query.offset ?? 0),
      limit: String(query.limit ?? 20),
    });
    return mapSearchResponse(widened);
  }

  return mapSearchResponse(raw);
}

function mapSearchResponse(raw: ModrinthSearchResponseRaw): ModrinthSearchResult {
  const hits: ModrinthSearchHit[] = raw.hits.map((h) => ({
    projectId: h.project_id,
    slug: h.slug,
    title: h.title,
    description: h.description,
    author: h.author,
    iconUrl: h.icon_url,
    downloads: h.downloads,
    follows: h.follows,
    categories: h.categories,
    loaders: h.display_categories.filter((c) =>
      ["fabric", "forge", "neoforge", "quilt"].includes(c)
    ),
    latestVersionId: h.latest_version || null,
    projectType: h.project_type,
  }));

  return { hits, totalHits: raw.total_hits, offset: raw.offset, limit: raw.limit };
}

interface ModrinthVersionRaw {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  changelog: string | null;
  game_versions: string[];
  loaders: string[];
  version_type: "release" | "beta" | "alpha";
  date_published: string;
  downloads: number;
  files: {
    filename: string;
    url: string;
    hashes: { sha1: string; sha512: string };
    size: number;
    primary: boolean;
  }[];
  dependencies?: {
    project_id: string;
    version_id: string | null;
    dependency_type: "required" | "optional" | "incompatible" | "embedded";
    file_name: string | null;
  }[];
}

function rawVersionToVersion(v: ModrinthVersionRaw): ModrinthVersion {
  return {
    id: v.id,
    projectId: v.project_id,
    name: v.name,
    versionNumber: v.version_number,
    changelog: v.changelog,
    gameVersions: v.game_versions,
    loaders: v.loaders,
    versionType: v.version_type,
    datePublished: v.date_published,
    downloads: v.downloads,
    files: v.files.map((f) => ({
      filename: f.filename,
      url: f.url,
      sha1: f.hashes.sha1,
      size: f.size,
      primary: f.primary,
    })),
    dependencies: (v.dependencies ?? []).map((d) => ({
      projectId: d.project_id,
      versionId: d.version_id,
      dependencyType: d.dependency_type,
      fileName: d.file_name,
    })),
  };
}

/**
 * Compatible versions for a project, filtered by loader + game version when given.
 *
 * Modrinth's server-side version filter does an EXACT string match against each
 * version's tagged game_versions list. Mod authors frequently only tag the versions
 * they explicitly tested (e.g. "1.21" but never republish for "1.21.1", even though
 * the mod works fine on it) — so a strict loaders+game_versions query can come back
 * empty even when a real, working option exists. Failing straight to "no compatible
 * version" off that strict result is exactly the false negative this exists to avoid:
 * if the strict query is empty, we fall back to a loader-only query and return
 * whatever Modrinth has, so the caller can show real options instead of a dead end.
 * Every returned version still carries its own real `gameVersions` list, so the UI can
 * make it clear to the user which ones are an exact match for their instance.
 */
export async function getProjectVersions(
  projectId: string,
  loader?: ModLoader,
  gameVersion?: string
): Promise<ModrinthVersion[]> {
  const strict: Record<string, string> = {};
  if (loader) strict.loaders = JSON.stringify([loader]);
  if (gameVersion) strict.game_versions = JSON.stringify([gameVersion]);

  const strictResult = await modrinthFetch<ModrinthVersionRaw[]>(`/project/${projectId}/version`, strict);
  if (strictResult.length > 0 || !gameVersion) {
    return strictResult.map(rawVersionToVersion);
  }

  // Strict (loader + exact game version) came back empty — widen to loader-only so a
  // real but differently-tagged version isn't hidden from the user.
  const loose: Record<string, string> = {};
  if (loader) loose.loaders = JSON.stringify([loader]);
  const looseResult = await modrinthFetch<ModrinthVersionRaw[]>(`/project/${projectId}/version`, loose);
  return looseResult.map(rawVersionToVersion);
}

export async function getVersion(versionId: string): Promise<ModrinthVersion> {
  const raw = await modrinthFetch<ModrinthVersionRaw>(`/version/${versionId}`);
  return rawVersionToVersion(raw);
}

export interface ModrinthProject {
  projectId: string;
  slug: string;
  title: string;
  iconUrl: string | null;
}

interface ModrinthProjectRaw {
  id: string;
  slug: string;
  title: string;
  icon_url: string | null;
}

/** Best-effort project metadata (title/icon) used to render dependency names. */
export async function getProject(projectId: string): Promise<ModrinthProject> {
  const raw = await modrinthFetch<ModrinthProjectRaw>(`/project/${projectId}`);
  return { projectId: raw.id, slug: raw.slug, title: raw.title, iconUrl: raw.icon_url };
}
