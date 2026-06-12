import type { AssetClassSlug } from "../asset-class-slugs";

export const SECURITY_TYPES = [
  "etf", "mutual_fund", "stock", "bond", "cash", "other",
] as const;
export type SecurityType = typeof SECURITY_TYPES[number];

export function isSecurityType(v: unknown): v is SecurityType {
  return typeof v === "string" && (SECURITY_TYPES as readonly string[]).includes(v);
}

/** Provider-agnostic, normalized input to the derivation algorithm.
 *  Percentages are 0–100 unless noted. Adapters produce this shape. */
export interface ClassifierInput {
  securityType: SecurityType;
  ticker?: string;
  /** When set, the security is classified directly to this single slug and the
   *  allocation/stock derivation is skipped entirely. Used by category-first
   *  adapters (a definitive Morningstar category) and the cash-sentinel guard.
   *  `inflation` is the editable unknown residual; `cash` is the locked class. */
  definitiveSlug?: AssetClassSlug;
  // ── Fund fields ────────────────────────────────────────────────
  /** Net-assets %, by top-level asset bucket. */
  assetAllocation?: {
    stockUS: number;
    stockNonUS: number;
    bond: number;
    cash: number;
    other: number;
  };
  /** Equity market-cap tiers as %, summing ≈ 100 across the equity sleeve. */
  marketCapTiers?: { mega: number; big: number; medium: number; small: number; micro: number };
  /** Of the non-US equity sleeve, the % that is emerging-market. */
  emergingPctOfNonUS?: number;
  /** Of total equity, the % in the Real Estate sector. */
  realEstatePctOfEquity?: number;
  /** Morningstar benchmark / category string, used for bond + commodity keyword rules. */
  categoryBenchmark?: string;
  // ── Individual-stock fields ────────────────────────────────────
  stockMarketCapUsd?: number;
  stockCountry?: string; // ISO-2 or "USA"
}

export interface AssetClassWeightBySlug {
  slug: AssetClassSlug;
  weight: number; // 0–1
}

export interface ClassifiedSecurity {
  identifierType: "ticker" | "cusip" | "figi";
  identifier: string;
  figi?: string;
  name?: string;
  securityType: SecurityType;
  classifierSource: "eodhd" | "seed" | "manual";
  classifierVersion: number;
  rawPayload?: unknown;
  weights: AssetClassWeightBySlug[];
}

/** Port: any provider that can classify an identifier implements this. */
export interface SecurityClassifier {
  classify(identifier: string): Promise<ClassifiedSecurity | null>;
}

export const CLASSIFIER_VERSION = 1;
