import {
  RISK_LEVELS,
  type Placement,
  type RiskLevel,
  type RungPortfolio,
  type SuitabilitySnapshot,
} from "./types";

const rungIndex = (level: RiskLevel): number => RISK_LEVELS.indexOf(level);

/**
 * Place a portfolio on the firm's five-rung risk scale.
 *
 * A model portfolio the firm has tagged carries its rung directly. Anything
 * else — an ad-hoc ticker portfolio, a client's existing holdings — is placed
 * at the rung whose tagged portfolio has the closest CMA volatility, and
 * marked `estimated` so the report can say so.
 *
 * Ties resolve to the more conservative rung: `RISK_LEVELS` is ordered
 * ascending and the comparison is strict, so the earlier entry wins. On a
 * suitability claim, erring low is the safe direction.
 */
export function placePortfolio(
  known: RiskLevel | null,
  volatility: number,
  rungs: readonly RungPortfolio[],
): Placement | null {
  if (known) return { level: known, estimated: false };
  if (rungs.length === 0) return null;

  const ordered = [...rungs].sort((a, b) => rungIndex(a.level) - rungIndex(b.level));
  let best = ordered[0];
  for (const r of ordered) {
    if (Math.abs(r.volatility - volatility) < Math.abs(best.volatility - volatility)) {
      best = r;
    }
  }
  return { level: best.level, estimated: true };
}

export interface BuildSuitabilityInput {
  profile: {
    compositeLevel: RiskLevel | null;
    compositeScore: number | null;
    bindingConstraint: "tolerance" | "capacity" | "none";
    confirmedAt: string | null;
  } | null;
  currentLevel: RiskLevel | null;
  currentVolatility: number;
  proposedLevel: RiskLevel | null;
  proposedVolatility: number;
  rungs: readonly RungPortfolio[];
}

export function buildSuitability(input: BuildSuitabilityInput): SuitabilitySnapshot {
  const currentPlacement = placePortfolio(input.currentLevel, input.currentVolatility, input.rungs);
  const proposedPlacement = placePortfolio(input.proposedLevel, input.proposedVolatility, input.rungs);
  const clientLevel = input.profile?.compositeLevel ?? null;

  // With no documented profile there is nothing to compare against, so both
  // verdicts stay false. The report renders a "complete the risk
  // questionnaire" prompt rather than a claim nobody can support.
  const clientIdx = clientLevel ? rungIndex(clientLevel) : null;

  return {
    clientLevel,
    clientScore: input.profile?.compositeScore ?? null,
    bindingConstraint: input.profile?.bindingConstraint ?? "none",
    confirmedAt: input.profile?.confirmedAt ?? null,
    currentPlacement,
    proposedPlacement,
    currentExceedsProfile:
      clientIdx != null && currentPlacement != null
        ? rungIndex(currentPlacement.level) > clientIdx
        : false,
    proposedMatchesProfile:
      clientIdx != null && proposedPlacement != null
        ? rungIndex(proposedPlacement.level) === clientIdx
        : false,
  };
}
