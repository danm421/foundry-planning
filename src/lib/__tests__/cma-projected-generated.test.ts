import { describe, it, expect } from "vitest";
import generated from "../cma-projected.generated.json";
import cmaDefaults from "../cma-defaults.generated.json";
import horizonSource from "../cma-projected-horizon.source.json";
import {
  buildProjectedAssetClasses,
  type HorizonSource,
} from "../cma-projected-build";
import type { SeedAssetClass } from "../cma-seed";

describe("cma-projected.generated.json", () => {
  it("has exactly 16 classes (cma-sets.ts consumer relies on this)", () => {
    expect(generated.assetClasses).toHaveLength(16);
  });

  it("matches the transform output (re-run recompute:cma-projected if this fails)", () => {
    const built = buildProjectedAssetClasses(
      horizonSource as HorizonSource,
      cmaDefaults.assetClasses as SeedAssetClass[],
    );
    expect(generated.assetClasses).toEqual(built);
  });

  it("no longer carries the placeholder source string", () => {
    expect(generated.meta.source).not.toMatch(/PLACEHOLDER/i);
  });
});
