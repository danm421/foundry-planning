import type { RiskLevel } from "@/lib/risk-levels";

export type MismatchState =
  | { kind: "no_profile" }
  | { kind: "untagged"; level: RiskLevel; buckets: BucketReadout[] }
  | { kind: "aligned"; level: RiskLevel; targetName: string; buckets: BucketReadout[] }
  | {
      kind: "mismatch";
      level: RiskLevel;
      targetName: string;
      applyToPortfolioId: string;
      buckets: BucketReadout[];
    };

export function describeMismatch(args: {
  compositeLevel: RiskLevel | null;
  /** The firm's model portfolio tagged with the composite level, if any. */
  profilePortfolioId: string | null;
  /** That portfolio's name. Null when the id is null, or when the lookup missed. */
  profilePortfolioName: string | null;
  /** The portfolio the base scenario is effectively driven by (see
   *  `effectiveScenarioPortfolioId`). */
  scenarioPortfolioId: string | null;
  /** Per-bucket readout of what the scenario actually runs on. */
  buckets: BucketReadout[];
}): MismatchState {
  if (!args.compositeLevel) return { kind: "no_profile" };
  // `untagged` carries no targetName by construction: no portfolio is tagged
  // at this rung, so there is no name to show.
  if (!args.profilePortfolioId) {
    return { kind: "untagged", level: args.compositeLevel, buckets: args.buckets };
  }
  const targetName = args.profilePortfolioName ?? "Unknown portfolio";
  if (args.profilePortfolioId === args.scenarioPortfolioId) {
    return { kind: "aligned", level: args.compositeLevel, targetName, buckets: args.buckets };
  }
  return {
    kind: "mismatch",
    level: args.compositeLevel,
    targetName,
    applyToPortfolioId: args.profilePortfolioId,
    buckets: args.buckets,
  };
}

/**
 * The portfolio the base scenario is ACTUALLY driven by, or null when it is not
 * cleanly driven by one. Null covers three distinct drift states, all of which
 * must read as "mismatch" rather than "aligned":
 *   - either bucket's growth source is not "model_portfolio" (a stale id can
 *     sit in the column while the engine ignores it -- the source defaults to
 *     "inflation"),
 *   - the two buckets point at different portfolios (applyRiskPortfolioToScenario
 *     writes both, but the assumptions UI edits them independently),
 *   - no plan settings row.
 */
export function effectiveScenarioPortfolioId(
  settings: {
    growthSourceTaxable: string;
    growthSourceRetirement: string;
    modelPortfolioIdTaxable: string | null;
    modelPortfolioIdRetirement: string | null;
  } | null,
): string | null {
  if (!settings) return null;
  if (settings.growthSourceTaxable !== "model_portfolio") return null;
  if (settings.growthSourceRetirement !== "model_portfolio") return null;
  if (!settings.modelPortfolioIdTaxable || !settings.modelPortfolioIdRetirement) return null;
  if (settings.modelPortfolioIdTaxable !== settings.modelPortfolioIdRetirement) return null;
  return settings.modelPortfolioIdTaxable;
}

/** One row of the card's "what is this bucket actually using" readout. */
export type BucketReadout = { label: string; value: string };

const SOURCE_WORDS: Record<string, string> = {
  inflation: "Inflation",
  asset_mix: "Account asset mix",
  holdings: "Holdings",
  ticker_portfolio: "Ticker portfolio",
  default: "Firm default",
};

/**
 * The human label for one bucket's growth configuration. Covers all seven
 * `growth_source` enum values -- the Growth & Inflation dropdown only offers
 * four of them, but the other three are reachable in data and must render a
 * word rather than a blank cell.
 */
export function describeBucketSource(args: {
  source: string;
  portfolioId: string | null;
  /** The bucket's flat rate as a decimal string, e.g. "0.0600". */
  customRate: string | null;
  portfolioNames: Map<string, string>;
}): string {
  if (args.source === "model_portfolio") {
    // A null id here is not a bug in this function: the FK is `on delete set
    // null`, so deleting a portfolio in CMA strands the enum over a null id.
    const name = args.portfolioId ? args.portfolioNames.get(args.portfolioId) : undefined;
    return name ?? "Unknown portfolio";
  }
  if (args.source === "custom") {
    if (args.customRate === null) return "Custom";
    // decimal(5,4) arrives as a string; same formatter the editor uses.
    return `Custom ${(Number(args.customRate) * 100).toFixed(2)}%`;
  }
  return SOURCE_WORDS[args.source] ?? "Not set";
}
