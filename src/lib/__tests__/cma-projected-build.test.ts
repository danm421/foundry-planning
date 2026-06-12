import { describe, it, expect } from "vitest";
import horizonSource from "../cma-projected-horizon.source.json";
import cmaDefaults from "../cma-defaults.generated.json";
import {
  buildProjectedAssetClasses,
  type HorizonSource,
  type ProjectedAssetClass,
} from "../cma-projected-build";
import type { SeedAssetClass } from "../cma-seed";
import type { AssetClassSlug } from "../investments/asset-class-slugs";

const HISTORICAL = cmaDefaults.assetClasses as SeedAssetClass[];
const histBySlug = new Map(HISTORICAL.map((c) => [c.slug, c]));

function build(): ProjectedAssetClass[] {
  return buildProjectedAssetClasses(horizonSource as HorizonSource, HISTORICAL);
}
const bySlug = new Map(build().map((c) => [c.slug, c]));

describe("buildProjectedAssetClasses", () => {
  it("returns all 16 classes in the same order as historical", () => {
    const out = build();
    expect(out).toHaveLength(16);
    expect(out.map((c) => c.slug)).toEqual(HISTORICAL.map((c) => c.slug));
  });

  it("maps a Direct class (US Large Cap) to Horizon 20yr geom, derives arithmetic", () => {
    const c = bySlug.get("us_large_cap")!;
    expect(c.geometricReturn).toBe(0.07);
    expect(c.volatility).toBe(0.1654);
    expect(c.arithmeticMean).toBe(0.0837); // 0.07 + 0.1654^2/2
    expect(c.provenance).toBe("direct:us_eq_large_cap");
  });

  it("gives Mid and Small Cap the identical shared SMID figure", () => {
    const mid = bySlug.get("us_mid_cap")!;
    const small = bySlug.get("us_small_cap")!;
    expect(mid.geometricReturn).toBe(0.0738);
    expect(mid.volatility).toBe(0.2044);
    expect(mid.arithmeticMean).toBe(0.0947); // 0.0738 + 0.2044^2/2
    expect(small.geometricReturn).toBe(mid.geometricReturn);
    expect(small.volatility).toBe(mid.volatility);
    expect(small.arithmeticMean).toBe(mid.arithmeticMean);
    expect(mid.provenance).toBe("direct:us_eq_smid");
  });

  it("maps Global ex-US to Non-US Developed (not blended with EM)", () => {
    const c = bySlug.get("global_ex_us")!;
    expect(c.geometricReturn).toBe(0.0735);
    expect(c.volatility).toBe(0.182);
    expect(c.arithmeticMean).toBe(0.0901);
  });

  it("Hybrid class (Short Term Treasury) takes Horizon return + historical vol", () => {
    const c = bySlug.get("short_term_treasury")!;
    const hist = histBySlug.get("short_term_treasury")!;
    expect(c.geometricReturn).toBe(0.0359); // Horizon cash-equiv geom20
    expect(c.volatility).toBe(hist.volatility); // historical vol preserved
    expect(c.arithmeticMean).toBe(0.0361); // 0.0359 + vol^2/2
    expect(c.provenance).toBe("hybrid:us_treasuries_cash+historical_vol");
  });

  it.each(["ten_year_treasury", "tax_exempt_muni", "long_term_treasury", "gold"])(
    "Carried class %s copies historical geom/arith/vol verbatim",
    (slug) => {
      const c = bySlug.get(slug as AssetClassSlug)!;
      const hist = histBySlug.get(slug as AssetClassSlug)!;
      expect(c.geometricReturn).toBe(hist.geometricReturn);
      expect(c.arithmeticMean).toBe(hist.arithmeticMean);
      expect(c.volatility).toBe(hist.volatility);
      expect(c.provenance).toBe("carry:historical");
    },
  );

  it("derives arithmetic = geometric + vol^2/2 for every Horizon-sourced class", () => {
    for (const c of build()) {
      if (c.provenance === "carry:historical") continue;
      const expected = Number((c.geometricReturn + (c.volatility * c.volatility) / 2).toFixed(4));
      expect(c.arithmeticMean).toBe(expected);
    }
  });

  it("carries structural fields (assetType + tax composition) unchanged", () => {
    for (const c of build()) {
      const hist = histBySlug.get(c.slug)!;
      expect(c.name).toBe(hist.name);
      expect(c.assetType).toBe(hist.assetType);
      expect(c.pctOrdinaryIncome).toBe(hist.pctOrdinaryIncome);
      expect(c.pctLtCapitalGains).toBe(hist.pctLtCapitalGains);
      expect(c.pctQualifiedDividends).toBe(hist.pctQualifiedDividends);
      expect(c.pctTaxExempt).toBe(hist.pctTaxExempt);
    }
  });

  it("is deterministic", () => {
    expect(build()).toEqual(build());
  });
});
