import { describe, it, expect } from "vitest";
import { analyzeCrash } from "./crashAnalysis";
import type { ConsoleLine } from "../stores/useLaunchStore";

const line = (l: string): ConsoleLine => ({ line: l, stream: "stdout", timestamp: 0 });

describe("analyzeCrash", () => {
  it("detects JVM init failure", () => {
    const info = analyzeCrash([line("Could not create the Java Virtual Machine.")], null);
    expect(info.patternId).toBe("jvm_init_failed");
    expect(info.reason).toContain("Java could not start");
  });

  it("detects OutOfMemoryError", () => {
    const info = analyzeCrash([line("java.lang.OutOfMemoryError: Java heap space")], 1);
    expect(info.patternId).toBe("out_of_memory");
    expect(info.hint).toContain("Increase the allocated RAM");
  });

  it("detects missing classes / dependencies", () => {
    const info = analyzeCrash([line("java.lang.NoClassDefFoundError: org/slf4j/Logger")], 1);
    expect(info.patternId).toBe("missing_dependency");
  });

  it("detects duplicate mods", () => {
    const info = analyzeCrash([line("DuplicateModsFoundException: found two of sodium")], 1);
    expect(info.patternId).toBe("duplicate_mods");
  });

  it("detects mod resolution failures", () => {
    const info = analyzeCrash(
      [line("net.fabricmc.loader.impl.discovery.ModResolutionException: Couldn't resolve mod foo")],
      1
    );
    expect(info.patternId).toBe("missing_dependencies");
  });

  it("falls back to a generic diagnosis carrying the exit code", () => {
    const info = analyzeCrash([line("nothing recognizable here")], -1);
    expect(info.patternId).toBe("generic");
    expect(info.reason).toContain("-1");
  });

  it("reports the first matching pattern greedily (JVM init beats OOM)", () => {
    const info = analyzeCrash(
      [
        line("Could not create the Java Virtual Machine."),
        line("java.lang.OutOfMemoryError: unable to create native thread"),
      ],
      1
    );
    expect(info.patternId).toBe("jvm_init_failed");
  });
});