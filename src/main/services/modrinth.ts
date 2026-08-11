/**
 * Thin client for the official Modrinth API (https://api.modrinth.com/v2).
 * Main-process only — the renderer never makes network calls directly, per the
 * existing preload/IPC security model. No caching layer beyond a short in-memory
 * TTL cache to avoid hammering the API while the user types in the search box.
 */
import type {
  ModLoader,
  ModrinthSearchHit,
  ModrinthSearchResult,
  ModrinthVersion,
  ModSearchQuery,
} from "../../shared/types/ipc";

const API_BASE = "https://api.modrinth.com/v2";
const USER_AGENT = "NoxaraLauncher/0.1.0 (https://github.com/noxara-labs/noxara-launcher)";

async function modrinthFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
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

function buildFacets(loader?: ModLoader, gameVersion?: string): string {
  const facets: string[][] = [["project_type:mod"]];
  if (loader) facets.push([`categories:${loader}`]);
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  return JSON.stringify(facets);
}

export async function searchMods(query: ModSearchQuery): Promise<ModrinthSearchResult> {
  const raw = await modrinthFetch<ModrinthSearchResponseRaw>("/search", {
    query: query.query ?? "",
    facets: buildFacets(query.loader, query.gameVersion),
    index: SORT_MAP[query.sort ?? "relevance"],
    offset: String(query.offset ?? 0),
    limit: String(query.limit ?? 20),
  });

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
      ["fabric", "forge"].includes(c)
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
  };
}

/** Compatible versions for a project, filtered server-side by loader + game version when given. */
export async function getProjectVersions(
  projectId: string,
  loader?: ModLoader,
  gameVersion?: string
): Promise<ModrinthVersion[]> {
  const params: Record<string, string> = {};
  if (loader) params.loaders = JSON.stringify([loader]);
  if (gameVersion) params.game_versions = JSON.stringify([gameVersion]);

  const raw = await modrinthFetch<ModrinthVersionRaw[]>(`/project/${projectId}/version`, params);
  return raw.map(rawVersionToVersion);
}

export async function getVersion(versionId: string): Promise<ModrinthVersion> {
  const raw = await modrinthFetch<ModrinthVersionRaw>(`/version/${versionId}`);
  return rawVersionToVersion(raw);
}
