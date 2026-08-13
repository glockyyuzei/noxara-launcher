import { describe, it, expect } from "vitest";
import { buildFacets } from "./modrinth";

describe("buildFacets", () => {
  it("always scopes to the project type", () => {
    expect(buildFacets("mod")).toBe(JSON.stringify([["project_type:mod"]]));
  });

  it("adds loader, game version and category facets", () => {
    const facets = JSON.parse(buildFacets("mod", "fabric", "1.21.1", "performance")) as string[][];
    expect(facets).toEqual([
      ["project_type:mod"],
      ["categories:fabric"],
      ["versions:1.21.1"],
      ["categories:performance"],
    ]);
  });

  it("maps 'client' to a single client_side OR-facet", () => {
    const facets = JSON.parse(buildFacets("mod", undefined, undefined, undefined, "client")) as string[][];
    expect(facets).toContainEqual(["client_side:required", "client_side:optional"]);
    expect(facets.some((f) => f[0]?.startsWith("server_side"))).toBe(false);
  });

  it("maps 'both' to client_side AND server_side facets", () => {
    const facets = JSON.parse(buildFacets("mod", undefined, undefined, undefined, "both")) as string[][];
    expect(facets).toContainEqual(["client_side:required", "client_side:optional"]);
    expect(facets).toContainEqual(["server_side:required", "server_side:optional"]);
  });

  it("adds no environment facet for 'all' or undefined", () => {
    expect(buildFacets("mod", undefined, undefined, undefined, "all")).toBe(
      JSON.stringify([["project_type:mod"]])
    );
  });
});