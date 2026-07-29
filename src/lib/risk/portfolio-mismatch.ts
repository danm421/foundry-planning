import type { RiskLevel } from "@/lib/risk-levels";

export type MismatchState =
  | { kind: "no_profile" }
  | { kind: "untagged"; level: RiskLevel }
  | { kind: "aligned"; level: RiskLevel }
  | { kind: "mismatch"; level: RiskLevel; applyToPortfolioId: string };

export function describeMismatch(args: {
  compositeLevel: RiskLevel | null;
  /** The firm's model portfolio tagged with the composite level, if any. */
  profilePortfolioId: string | null;
  /** The portfolio the base scenario is effectively driven by (see
   *  `effectiveScenarioPortfolioId`). */
  scenarioPortfolioId: string | null;
}): MismatchState {
  if (!args.compositeLevel) return { kind: "no_profile" };
  if (!args.profilePortfolioId) return { kind: "untagged", level: args.compositeLevel };
  if (args.profilePortfolioId === args.scenarioPortfolioId) {
    return { kind: "aligned", level: args.compositeLevel };
  }
  return {
    kind: "mismatch",
    level: args.compositeLevel,
    applyToPortfolioId: args.profilePortfolioId,
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
