import { afterEach, describe, expect, it, vi } from "vitest";
import { getProjectVersions } from "./modrinth";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const RAW_VERSION = {
  id: "v1",
  project_id: "p1",
  name: "Mod 1.0.0",
  version_number: "1.0.0",
  changelog: null,
  game_versions: ["1.21"],
  loaders: ["fabric"],
  version_type: "release",
  date_published: "2024-01-01T00:00:00Z",
  downloads: 5,
  files: [
    {
      filename: "mod-1.0.0.jar",
      url: "https://cdn.modrinth.com/mod-1.0.0.jar",
      hashes: { sha1: "abc", sha512: "def" },
      size: 1024,
      primary: true,
    },
  ],
  dependencies: [
    { project_id: "dep1", version_id: "dv1", dependency_type: "required", file_name: null },
  ],
};

describe("getProjectVersions", () => {
  const fetchMock = vi.fn<typeof fetch>();
  let urls: string[] = [];

  afterEach(() => {
    vi.unstubAllGlobals();
    urls = [];
  });

  it("returns strict matches without a fallback query", async () => {
    fetchMock.mockImplementation(async (input) => {
      urls.push(String(input));
      return jsonResponse([RAW_VERSION]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const versions = await getProjectVersions("p1", "fabric", "1.21");
    expect(versions.length).toBe(1);
    expect(versions[0].projectId).toBe("p1");
    expect(versions[0].files[0].sha1).toBe("abc");
    expect(versions[0].dependencies[0].projectId).toBe("dep1");
    expect(urls).toHaveLength(1); // no fallback happened
  });

  it("falls back to a loader-only query when the strict query returns nothing", async () => {
    fetchMock.mockImplementation(async (input) => {
      urls.push(String(input));
      // First (strict) call returns empty; second (loose) returns a version.
      return jsonResponse(urls.length === 1 ? [] : [RAW_VERSION]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const versions = await getProjectVersions("p1", "fabric", "1.21");
    expect(urls).toHaveLength(2); // strict + loose
    expect(versions.length).toBe(1);
    expect(urls[0]).toContain("game_versions");
    expect(urls[1]).not.toContain("game_versions");
  });

  it("does not fall back when only a game version was requested (no loader)", async () => {
    fetchMock.mockImplementation(async (input) => {
      urls.push(String(input));
      return jsonResponse([RAW_VERSION]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const versions = await getProjectVersions("p1", undefined, "1.21");
    expect(urls).toHaveLength(1);
    expect(versions).toHaveLength(1);
  });

  it("normalizes hostile/missing fields without crashing", async () => {
    fetchMock.mockImplementation(async () =>
      jsonResponse([
        {
          id: "v2",
          project_id: "p1",
          name: null,
          version_number: null,
          changelog: null,
          game_versions: null,
          loaders: null,
          version_type: null,
          date_published: null,
          downloads: null,
          files: [],
          dependencies: undefined,
        },
      ])
    );
    vi.stubGlobal("fetch", fetchMock);

    const versions = await getProjectVersions("p1", "fabric", "1.21");
    expect(versions).toHaveLength(1);
    expect(versions[0].files).toEqual([]);
    expect(versions[0].dependencies).toEqual([]);
  });
});