import type { AssetClassSlug } from "../asset-class-slugs";
import type { ClassifierInput, AssetClassWeightBySlug } from "./types";
import { classifyBondBenchmark, classifyCommodityLike } from "./rules";

// Minimal emerging-market country set (ISO-2). Extend over time; unknowns
// default to developed (global_ex_us). EM refinement tracked in spec risks.
const EM_COUNTRIES = new Set([
  "BR", "CN", "IN", "ZA", "MX", "RU", "ID", "TR", "TH", "MY",
  "PH", "CL", "CO", "PE", "EG", "GR", "HU", "PL", "QA", "AE", "SA", "TW", "KR",
]);

function add(map: Map<AssetClassSlug, number>, slug: AssetClassSlug, w: number): void {
  if (!(w > 0) || !Number.isFinite(w)) return;
  map.set(slug, (map.get(slug) ?? 0) + w);
}

function finalize(map: Map<AssetClassSlug, number>): AssetClassWeightBySlug[] {
  const total = [...map.values()].reduce((a, b) => a + b, 0);
  // Whatever is missing (cash, unmatched residual, empty) → inflation.
  if (total < 1) add(map, "inflation", 1 - total);
  const sum = [...map.values()].reduce((a, b) => a + b, 0) || 1;
  return [...map.entries()]
    .map(([slug, w]) => ({ slug, weight: w / sum }))
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.weight - a.weight);
}

function deriveStock(input: ClassifierInput): AssetClassWeightBySlug[] {
  const map = new Map<AssetClassSlug, number>();
  const country = (input.stockCountry ?? "USA").toUpperCase();
  if (country !== "USA" && country !== "US") {
    add(map, EM_COUNTRIES.has(country) ? "emerging_markets" : "global_ex_us", 1);
    return finalize(map);
  }
  const cap = input.stockMarketCapUsd ?? Infinity;
  if (cap >= 10e9) add(map, "us_large_cap", 1);
  else if (cap >= 2e9) add(map, "us_mid_cap", 1);
  else add(map, "us_small_cap", 1);
  return finalize(map);
}

function deriveFund(input: ClassifierInput): AssetClassWeightBySlug[] {
  const map = new Map<AssetClassSlug, number>();
  const a = input.assetAllocation;
  if (!a) return finalize(map); // no data → all inflation residual

  const f = (x: number) => Math.max(0, x) / 100;
  let usEq = f(a.stockUS);
  let intlEq = f(a.stockNonUS);
  const bond = f(a.bond);
  const other = f(a.other);
  const equity = usEq + intlEq;

  // Carve REIT proportionally out of the equity sleeves.
  const reitFrac = equity * Math.max(0, Math.min(1, (input.realEstatePctOfEquity ?? 0) / 100));
  if (reitFrac > 0 && equity > 0) {
    const usShare = usEq / equity;
    add(map, "reit", reitFrac);
    usEq -= reitFrac * usShare;
    intlEq -= reitFrac * (1 - usShare);
  }

  // US equity → cap tiers.
  const tiers = input.marketCapTiers;
  if (usEq > 0) {
    const tt = tiers ? tiers.mega + tiers.big + tiers.medium + tiers.small + tiers.micro : 0;
    if (tiers && tt > 0) {
      add(map, "us_large_cap", (usEq * (tiers.mega + tiers.big)) / tt);
      add(map, "us_mid_cap", (usEq * tiers.medium) / tt);
      add(map, "us_small_cap", (usEq * (tiers.small + tiers.micro)) / tt);
    } else {
      add(map, "us_large_cap", usEq);
    }
  }

  // Non-US equity → developed vs emerging.
  if (intlEq > 0) {
    const emFrac = Math.max(0, Math.min(1, (input.emergingPctOfNonUS ?? 0) / 100));
    add(map, "emerging_markets", intlEq * emFrac);
    add(map, "global_ex_us", intlEq * (1 - emFrac));
  }

  // Bond sleeve → one bond class by benchmark keywords.
  if (bond > 0) add(map, classifyBondBenchmark(input.categoryBenchmark), bond);

  // Other sleeve → gold / commodities, else residual (→ inflation in finalize).
  if (other > 0) {
    const commodity = classifyCommodityLike(input.ticker, input.categoryBenchmark);
    if (commodity) add(map, commodity, other);
  }

  // Cash sleeve → cash asset class (reduces inflation residual in finalize).
  const cash = f(a.cash);
  if (cash > 0) add(map, "cash", cash);

  return finalize(map);
}

export function deriveAssetClassBlend(input: ClassifierInput): AssetClassWeightBySlug[] {
  if (input.definitiveSlug) return finalize(new Map([[input.definitiveSlug, 1]]));
  switch (input.securityType) {
    case "stock":
      return deriveStock(input);
    case "bond":
      return finalize(new Map([[classifyBondBenchmark(input.categoryBenchmark), 1]]));
    case "etf":
    case "mutual_fund":
      return deriveFund(input);
    case "cash":
      return finalize(new Map([["cash", 1]]));
    default:
      return finalize(new Map()); // other with no data → inflation
  }
}
