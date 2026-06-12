// src/lib/investments/classification/eodhd-adapter.ts
import type { ClassifierInput, SecurityType } from "./types";
import { isCashFund } from "./rules";

// EODHD region buckets we treat as emerging.
const EM_REGIONS = [
  "latin america", "emerging europe", "asia emerging", "africa/middle east", "africa", "middle east",
];

function num(v: unknown): number {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : 0;
}

function mapSecurityType(rawType: string | undefined): SecurityType {
  const t = (rawType ?? "").toLowerCase();
  if (t.includes("etf")) return "etf";
  if (t.includes("fund")) return "mutual_fund";
  if (t.includes("bond") || t.includes("note")) return "bond";
  if (t.includes("stock") || t.includes("share") || t.includes("equity")) return "stock";
  return "other";
}

/** Pure: raw EODHD fundamentals JSON → ClassifierInput. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mapEodhdToInput(ticker: string, raw: any): ClassifierInput {
  const securityType = mapSecurityType(raw?.General?.Type);

  // Money-market / cash funds are cash-equivalents for planning. EODHD types
  // them as a fund (occasionally "other") and rarely returns an allocation, so
  // route the whole position to the Cash class via a synthetic 100% cash sleeve
  // rather than letting the empty allocation fall into the inflation residual.
  if (isCashFund(ticker, raw?.General?.Name, raw?.General?.Type)) {
    return {
      securityType: securityType === "etf" ? "etf" : "mutual_fund",
      ticker,
      assetAllocation: { stockUS: 0, stockNonUS: 0, bond: 0, cash: 100, other: 0 },
    };
  }

  if (securityType === "etf" || securityType === "mutual_fund") {
    const data = raw.ETF_Data ?? raw.MutualFund_Data ?? {};
    const alloc = data.Asset_Allocation ?? {};
    const pick = (k: string) => num(alloc[k]?.["Net_Assets_%"]);
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
      assetAllocation: {
        stockUS: pick("Stock US"),
        stockNonUS: pick("Stock non-US"),
        bond: pick("Bond"),
        cash: pick("Cash"),
        other: pick("Other"),
      },
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
