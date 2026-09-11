// src/lib/investments/classification/eodhd-adapter.ts
import type { ClassifierInput, SecurityType } from "./types";
import { isCashFund, classifyCategory } from "./rules";

// EODHD region buckets we treat as emerging.
const EM_REGIONS = [
  "latin america", "emerging europe", "asia emerging", "africa/middle east", "africa", "middle east",
];

// Cash-sentinel guard: EODHD dumps any fund it can't decompose into a ~100% Cash
// "no data" bucket. A non-money-market fund (categories + names are handled
// first) whose allocation matches this shape is unknown → inflation residual,
// NEVER the locked Cash class.
const CASH_SENTINEL_PCT = 95;
const SENTINEL_NON_CASH_MAX = 5;

function num(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

/** Map an EODHD instrument-type string (`Common Stock`, `FUND`, `ETF`, …) to
 *  our SecurityType. Shared with the search-based name lookup. */
export function mapSecurityType(rawType: string | undefined): SecurityType {
  const t = (rawType ?? "").toLowerCase();
  if (t.includes("etf")) return "etf";
  if (t.includes("fund")) return "mutual_fund";
  if (t.includes("bond") || t.includes("note")) return "bond";
  if (t.includes("stock") || t.includes("share") || t.includes("equity")) return "stock";
  return "other";
}

// ── Mutual-fund payload normalisation ────────────────────────────────────────
// EODHD's `MutualFund_Data` block is NOT the same shape as `ETF_Data` — every
// field we read is renamed or re-nested. Normalising it up front keeps the
// classification logic below single-shape. Measured against the live responses
// for SWPPX.US / GFAFX.US / VFIDX.US on 2026-09-10.

/** `{ "4": { Type: "US Stock", "Net_%": "99.1" } }` → `{ "Stock US": { "Net_Assets_%": "99.1" } }` */
const MF_ALLOCATION_TYPES: Record<string, string> = {
  "us stock": "Stock US",
  "non us stock": "Stock non-US",
  bond: "Bond",
  cash: "Cash",
  other: "Other",
};

/** Morningstar's fund tiers vs the ETF block's. `AverageMarketCap` is an
 *  absolute dollar figure, not a percentage, and is deliberately dropped. */
const MF_CAP_TIERS: Record<string, string> = {
  giant: "Mega",
  large: "Big",
  medium: "Medium",
  small: "Small",
  micro: "Micro",
};

/** Rows of an index-keyed EODHD object (`{ "0": {...}, "1": {...} }`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowsOf(obj: unknown): any[] {
  return obj && typeof obj === "object" ? Object.values(obj as Record<string, unknown>) : [];
}

/** Flatten a group-of-rows block (`{ Americas: { "0": { Name, <valueKey> } } }`)
 *  into the ETF block's flat `{ [Name]: { "Equity_%": value } }`. */
function flattenNamedGroups(groups: unknown, valueKey: string): Record<string, { "Equity_%": number }> {
  const out: Record<string, { "Equity_%": number }> = {};
  for (const group of rowsOf(groups)) {
    for (const row of rowsOf(group)) {
      const name = row?.Name;
      if (typeof name === "string") out[name] = { "Equity_%": num(row?.[valueKey]) };
    }
  }
  return out;
}

/** Re-express a `MutualFund_Data` block in `ETF_Data`'s shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeMutualFundData(mf: any): any {
  const allocation: Record<string, { "Net_Assets_%": number }> = {};
  for (const row of rowsOf(mf?.Asset_Allocation)) {
    const key = MF_ALLOCATION_TYPES[String(row?.Type ?? "").toLowerCase()];
    if (key) allocation[key] = { "Net_Assets_%": num(row?.["Net_%"]) };
  }

  const caps: Record<string, number> = {};
  for (const row of rowsOf(mf?.Market_Capitalization)) {
    const tier = MF_CAP_TIERS[String(row?.Size ?? "").toLowerCase()];
    if (tier) caps[tier] = num(row?.["Portfolio_%"]);
  }

  return {
    Asset_Allocation: allocation,
    Market_Capitalisation: caps,
    World_Regions: flattenNamedGroups(mf?.World_Regions, "Stocks_%"),
    Sector_Weights: flattenNamedGroups(mf?.Sector_Weights, "Amount_%"),
    Index_Name: mf?.Fund_Category,
  };
}

/** The Morningstar category, wherever this payload happens to carry it.
 *  `General.Category` is populated for ETFs and is ALWAYS null for funds. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveCategory(raw: any): string | undefined {
  return raw?.General?.Category
    ?? raw?.General?.Fund_Category
    ?? raw?.MutualFund_Data?.Fund_Category
    ?? raw?.MutualFund_Data?.Morning_Star_Category
    ?? undefined;
}

/** Pure: raw EODHD fundamentals JSON → ClassifierInput. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapEodhdToInput(ticker: string, raw: any): ClassifierInput {
  const securityType = mapSecurityType(raw?.General?.Type);

  // Fund-like (etf / mutual_fund, and EODHD's occasional "other" typing for
  // funds): category-first. A definitive Morningstar category, or a money-market
  // name, overrides the unreliable Asset_Allocation.
  if (securityType === "etf" || securityType === "mutual_fund" || securityType === "other") {
    const fundType: SecurityType = securityType === "etf" ? "etf" : "mutual_fund";

    const catSlug = classifyCategory(resolveCategory(raw));
    if (catSlug) return { securityType: fundType, ticker, definitiveSlug: catSlug };

    if (isCashFund(ticker, raw?.General?.Name, raw?.General?.Type)) {
      return { securityType: fundType, ticker, definitiveSlug: "cash" };
    }
  }

  if (securityType === "etf" || securityType === "mutual_fund") {
    const data = raw.ETF_Data
      ?? (raw.MutualFund_Data ? normalizeMutualFundData(raw.MutualFund_Data) : undefined)
      ?? {};
    const alloc = data.Asset_Allocation ?? {};
    const pick = (k: string) => num(alloc[k]?.["Net_Assets_%"]);
    const assetAllocation = {
      stockUS: pick("Stock US"),
      stockNonUS: pick("Stock non-US"),
      bond: pick("Bond"),
      cash: pick("Cash"),
      other: pick("Other"),
    };

    // Sentinel guard — see CASH_SENTINEL_PCT above.
    // nonCash can be negative for leveraged/inverse funds; guard still fires correctly
    // (routing to inflation residual is safe — category-first already handles known cases).
    const nonCash = assetAllocation.stockUS + assetAllocation.stockNonUS + assetAllocation.bond + assetAllocation.other;
    if (assetAllocation.cash >= CASH_SENTINEL_PCT && nonCash <= SENTINEL_NON_CASH_MAX) {
      return { securityType, ticker, definitiveSlug: "inflation" };
    }

    const caps = data.Market_Capitalisation ?? {};
    const regions = data.World_Regions ?? {};
    let emEquity = 0, totalEquity = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const [name, v] of Object.entries<any>(regions)) {
      const eq = num(v?.["Equity_%"]);
      totalEquity += eq;
      if (EM_REGIONS.some((r) => name.toLowerCase().includes(r))) emEquity += eq;
    }
    const naEquity = num(regions["North America"]?.["Equity_%"]);
    const nonUSEquity = Math.max(0, totalEquity - naEquity);
    const emergingPctOfNonUS = nonUSEquity > 0 ? (emEquity / nonUSEquity) * 100 : 0;

    return {
      securityType,
      ticker,
      assetAllocation,
      marketCapTiers: {
        mega: num(caps.Mega), big: num(caps.Big), medium: num(caps.Medium),
        small: num(caps.Small), micro: num(caps.Micro),
      },
      emergingPctOfNonUS,
      realEstatePctOfEquity: num(data.Sector_Weights?.["Real Estate"]?.["Equity_%"]),
      categoryBenchmark: data.MorningStar?.Category_Benchmark ?? data.Index_Name,
    };
  }

  // Individual stock / bond.
  return {
    securityType,
    ticker,
    stockMarketCapUsd: num(raw?.Highlights?.MarketCapitalization) || undefined,
    stockCountry: raw?.General?.CountryISO ?? raw?.General?.CountryName,
    categoryBenchmark: raw?.General?.Name,
  };
}

const EODHD_BASE = "https://eodhd.com/api/fundamentals";

/** Fetch raw fundamentals for a ticker. Throws on misconfig / HTTP error;
 *  callers in the orchestrator catch and fail soft. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchEodhdFundamentals(ticker: string): Promise<any> {
  const key = process.env.EODHD_API_KEY ?? "";
  if (!key) {
    throw new Error("EODHD_API_KEY is not configured. Set it in .env.local to enable classification.");
  }
  const symbol = ticker.includes(".") ? ticker : `${ticker}.US`;
  const res = await fetch(`${EODHD_BASE}/${encodeURIComponent(symbol)}?api_token=${key}&fmt=json`);
  if (!res.ok) throw new Error(`EODHD fundamentals ${symbol}: HTTP ${res.status}`);
  return res.json();
}
