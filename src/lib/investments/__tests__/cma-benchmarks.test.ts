import { describe, it, expect } from "vitest";
import { ASSET_CLASS_SLUGS } from "../asset-class-slugs";
import { CMA_BENCHMARKS, benchmarkTooltip } from "../cma-benchmarks";

describe("CMA_BENCHMARKS", () => {
  // Every canonical slug except `inflation` (a forward CPI assumption, not a
  // market proxy) must carry benchmark provenance — guards against a new
  // recompute proxy landing without a tooltip entry.
  it("covers every canonical slug except inflation", () => {
    for (const slug of ASSET_CLASS_SLUGS) {
      if (slug === "inflation") {
        expect(CMA_BENCHMARKS[slug]).toBeUndefined();
      } else {
        expect(CMA_BENCHMARKS[slug], `missing benchmark for ${slug}`).toBeDefined();
      }
    }
  });

  it("adds no benchmarks beyond the canonical slugs", () => {
    for (const slug of Object.keys(CMA_BENCHMARKS)) {
      expect(ASSET_CLASS_SLUGS).toContain(slug);
    }
  });
});

describe("benchmarkTooltip", () => {
  it("formats index, proxy, ticker, and window", () => {
    expect(benchmarkTooltip("us_large_cap")).toBe(
      "S&P 500 Index — proxied by Vanguard 500 Index Fund (VFINX.US). Monthly total returns since Feb 1996.",
    );
  });

  it("returns null for inflation, unknown slugs, and nullish input", () => {
    expect(benchmarkTooltip("inflation")).toBeNull();
    expect(benchmarkTooltip("not_a_slug")).toBeNull();
    expect(benchmarkTooltip(null)).toBeNull();
    expect(benchmarkTooltip(undefined)).toBeNull();
  });
});
