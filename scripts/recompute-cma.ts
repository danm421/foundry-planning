import { writeFileSync, mkdirSync } from "node:fs";
import cmaDefaults from "../src/lib/cma-defaults.generated.json";
import { fetchMonthlyAdjustedClose } from "../src/lib/cma-eodhd-history";
import {
  monthlyReturns,
  annualizedArithmetic,
  annualizedGeometric,
  annualizedVolatility,
  pairwiseCorrelation,
  repairToPSD,
} from "../src/lib/cma-stats";

const FROM = "1996-01-01"; // ~30yr trailing window target
const ARITH_CAP = 2.0; // engine bound (eMoney whitepaper p.6)
const MIN_HISTORY_MONTHS = 120; // warn if < 10yr

// slug → EODHD symbol. "inflation" is intentionally absent (carried forward, no proxy).
const PROXY_MAP: Record<string, string> = {
  us_large_cap: "VFINX.US",
  us_mid_cap: "VIMSX.US",
  us_small_cap: "NAESX.US",
  global_ex_us: "VGTSX.US",
  emerging_markets: "VEIEX.US",
  short_term_treasury: "VFISX.US",
  ten_year_treasury: "VFITX.US",
  tips: "VIPSX.US",
  high_yield_corporate: "VWEHX.US",
  tax_exempt_muni: "VWITX.US",
  long_term_treasury: "VUSTX.US",
  reit: "VGSIX.US",
  gold: "XAUUSD.FOREX", // spot gold; no yield → price ≈ total return
  commodities: "GSG.US", // iShares GSCI; VERIFY history depth in Task 7
};

type SeedAssetClass = (typeof cmaDefaults.assetClasses)[number];
type SeedCorrelation = (typeof cmaDefaults.correlations)[number];

async function main() {
  const oldClasses = cmaDefaults.assetClasses as SeedAssetClass[];
  const warnings: string[] = [];

  // 1. Fetch + compute per-class stats and per-class monthly returns.
  const returnsBySlug = new Map<string, { date: string; r: number }[]>();
  const coverage: { slug: string; symbol: string; start: string; months: number }[] = [];

  const newClasses: SeedAssetClass[] = [];
  for (const cls of oldClasses) {
    const symbol = cls.slug ? PROXY_MAP[cls.slug] : undefined;
    if (!symbol) {
      // No proxy (e.g. inflation): carry forward unchanged.
      newClasses.push(cls);
      continue;
    }
    const bars = await fetchMonthlyAdjustedClose(symbol, { from: FROM });
    const rets = monthlyReturns(bars);
    if (rets.length < MIN_HISTORY_MONTHS) {
      warnings.push(
        `${cls.name} (${symbol}): only ${rets.length} months (< ${MIN_HISTORY_MONTHS}).`,
      );
    }
    returnsBySlug.set(cls.slug!, rets);
    coverage.push({
      slug: cls.slug!,
      symbol,
      start: rets[0]?.date ?? "n/a",
      months: rets.length,
    });
    const arith = annualizedArithmetic(rets.map((x) => x.r));
    if (arith > ARITH_CAP || arith < -1) {
      throw new Error(`${cls.name}: arithmetic mean ${arith} outside engine cap [-1, ${ARITH_CAP}]`);
    }
    const vol = annualizedVolatility(rets.map((x) => x.r));
    if (!(vol > 0)) throw new Error(`${cls.name}: non-positive volatility ${vol}`);
    newClasses.push({
      ...cls, // carry name/slug/assetType/tax composition unchanged
      geometricReturn: round4(annualizedGeometric(rets.map((x) => x.r))),
      arithmeticMean: round4(arith),
      volatility: round4(vol),
    });
  }

  // 2. Build correlation matrix over the proxied (non-inflation) classes.
  const corrSlugs = oldClasses.map((c) => c.slug).filter((s): s is string => !!s && returnsBySlug.has(s));
  const n = corrSlugs.length;
  const M: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) M[i][i] = 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const { rho } = pairwiseCorrelation(returnsBySlug.get(corrSlugs[i])!, returnsBySlug.get(corrSlugs[j])!);
      M[i][j] = rho;
      M[j][i] = rho;
    }
  }
  const { matrix: repaired, alpha } = repairToPSD(M);
  if (alpha > 0) warnings.push(`Correlation matrix was non-PSD; shrunk toward identity by alpha=${alpha}.`);

  // 3. Emit correlations as the upper-triangle name-pair list (matches SeedCorrelation).
  const slugToName = new Map(oldClasses.map((c) => [c.slug, c.name]));
  const newCorrelations: SeedCorrelation[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      newCorrelations.push({
        classA: slugToName.get(corrSlugs[i])!,
        classB: slugToName.get(corrSlugs[j])!,
        correlation: round2(repaired[i][j]),
      });
    }
  }

  // 4. Write the regenerated JSON (timestamp passed via env to keep the script deterministic).
  const generatedAt = process.env.RECOMPUTE_STAMP ?? "UNSTAMPED";
  const payload = {
    meta: {
      generatedAt,
      window: `${FROM}..present`,
      source: "eodhd-adjusted-close-monthly",
      proxies: Object.fromEntries(coverage.map((c) => [c.slug, { symbol: c.symbol, start: c.start, months: c.months }])),
    },
    assetClasses: newClasses,
    correlations: newCorrelations,
  };
  writeFileSync("src/lib/cma-defaults.generated.json", JSON.stringify(payload, null, 2) + "\n");

  // 5. Write a human-readable diff report.
  mkdirSync("scripts/output", { recursive: true });
  writeFileSync("scripts/output/cma-recompute-diff.md", renderDiff(oldClasses, newClasses, coverage, warnings));
  console.log("Wrote src/lib/cma-defaults.generated.json and scripts/output/cma-recompute-diff.md");
  if (warnings.length) console.warn("WARNINGS:\n" + warnings.map((w) => " - " + w).join("\n"));
}

const round4 = (x: number) => Number(x.toFixed(4));
const round2 = (x: number) => Number(x.toFixed(2));

function renderDiff(
  oldC: SeedAssetClass[],
  newC: SeedAssetClass[],
  coverage: { slug: string; symbol: string; start: string; months: number }[],
  warnings: string[],
): string {
  const bySlug = new Map(newC.map((c) => [c.slug, c]));
  const pct = (a: number, b: number) => (a === 0 ? "—" : (((b - a) / Math.abs(a)) * 100).toFixed(0) + "%");
  let out = "# CMA recompute diff\n\n## Asset classes (geo / arith / vol)\n\n";
  out += "| Class | geo old→new (Δ%) | arith old→new (Δ%) | vol old→new (Δ%) |\n|---|---|---|---|\n";
  for (const o of oldC) {
    const nu = bySlug.get(o.slug)!;
    out += `| ${o.name} | ${o.geometricReturn}→${nu.geometricReturn} (${pct(o.geometricReturn, nu.geometricReturn)}) | ${o.arithmeticMean}→${nu.arithmeticMean} (${pct(o.arithmeticMean, nu.arithmeticMean)}) | ${o.volatility}→${nu.volatility} (${pct(o.volatility, nu.volatility)}) |\n`;
  }
  out += "\n## Coverage\n\n| Class | Proxy | Start | Months |\n|---|---|---|---|\n";
  for (const c of coverage) out += `| ${c.slug} | ${c.symbol} | ${c.start} | ${c.months} |\n`;
  if (warnings.length) out += "\n## Warnings\n\n" + warnings.map((w) => "- " + w).join("\n") + "\n";
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
