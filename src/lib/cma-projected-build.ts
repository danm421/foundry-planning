import type { AssetClassSlug } from "./investments/asset-class-slugs";
import type { SeedAssetClass } from "./cma-seed";

/** One row of the committed Horizon source table. */
export interface HorizonClass {
  key: string;
  label: string;
  /** geom10/arith20 are preserved from the source table for provenance;
   *  the transform consumes only geom20 (return) and std (volatility). */
  geom10: number;
  arith20: number;
  geom20: number;
  std: number;
}

export interface HorizonSource {
  meta: {
    edition: string;
    asOf: string;
    horizon: string;
    source: string;
    respondents: number;
  };
  horizonClasses: HorizonClass[];
}

/** A generated projected class is a seed class plus an audit trail. */
export type ProjectedAssetClass = SeedAssetClass & { provenance: string };

type MappingRule =
  // geometric + vol straight from Horizon; arithmetic derived.
  | { method: "direct"; horizonKey: string }
  // geometric from Horizon, volatility kept from Historical; arithmetic derived.
  | { method: "hybrid"; horizonKey: string }
  // geometric/arithmetic/volatility copied verbatim from Historical.
  | { method: "carry" };

/**
 * Approved per-class mapping (see spec 2026-06-01-cma-projected-horizon-design).
 * Mid & Small Cap both reference Horizon's combined Small/Mid line.
 * Global ex-US maps to Non-US Developed (Emerging is modeled separately).
 * Treasury-maturity buckets, Muni, and Gold have no Horizon analog → carry.
 */
export const PROJECTED_MAPPING: Record<AssetClassSlug, MappingRule> = {
  us_large_cap: { method: "direct", horizonKey: "us_eq_large_cap" },
  us_mid_cap: { method: "direct", horizonKey: "us_eq_smid" },
  us_small_cap: { method: "direct", horizonKey: "us_eq_smid" },
  global_ex_us: { method: "direct", horizonKey: "non_us_eq_developed" },
  emerging_markets: { method: "direct", horizonKey: "non_us_eq_emerging" },
  short_term_treasury: { method: "hybrid", horizonKey: "us_treasuries_cash" },
  ten_year_treasury: { method: "carry" },
  tips: { method: "direct", horizonKey: "tips" },
  high_yield_corporate: { method: "direct", horizonKey: "us_corp_high_yield" },
  tax_exempt_muni: { method: "carry" },
  long_term_treasury: { method: "carry" },
  reit: { method: "direct", horizonKey: "real_estate" },
  gold: { method: "carry" },
  commodities: { method: "direct", horizonKey: "commodities" },
  inflation: { method: "direct", horizonKey: "inflation" },
  cash: { method: "carry" },
};

const round4 = (x: number): number => Number(x.toFixed(4));

export function buildProjectedAssetClasses(
  source: HorizonSource,
  historical: SeedAssetClass[],
): ProjectedAssetClass[] {
  const horizonByKey = new Map(source.horizonClasses.map((h) => [h.key, h]));

  return historical.map((hist): ProjectedAssetClass => {
    const rule = hist.slug ? PROJECTED_MAPPING[hist.slug] : undefined;
    if (!rule) {
      throw new Error(`cma-projected: no mapping for slug "${hist.slug ?? "(none)"}"`);
    }

    if (rule.method === "carry") {
      // geometric/arithmetic/volatility kept exactly as Historical.
      return { ...hist, provenance: "carry:historical" };
    }

    const hz = horizonByKey.get(rule.horizonKey);
    if (!hz) {
      throw new Error(`cma-projected: Horizon source missing key "${rule.horizonKey}"`);
    }

    const geometricReturn = round4(hz.geom20);
    const volatility =
      rule.method === "hybrid" ? round4(hist.volatility) : round4(hz.std);
    const arithmeticMean = round4(geometricReturn + (volatility * volatility) / 2);
    const provenance =
      rule.method === "hybrid"
        ? `hybrid:${rule.horizonKey}+historical_vol`
        : `direct:${rule.horizonKey}`;

    return { ...hist, geometricReturn, arithmeticMean, volatility, provenance };
  });
}
