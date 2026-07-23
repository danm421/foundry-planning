/**
 * The firm-facing risk ladder shared by `clients.risk_tolerance` and
 * `model_portfolios.risk_level`. The join between a client's tolerance and a
 * firm's tagged portfolio is exact string equality on these values — keep this
 * tuple, the `risk_level` pgEnum in `schema.ts`, and the two columns in lockstep.
 */
export const RISK_LEVELS = [
  "conservative",
  "moderately_conservative",
  "moderate",
  "moderately_aggressive",
  "aggressive",
] as const;

export type RiskLevel = (typeof RISK_LEVELS)[number];

export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  conservative: "Conservative",
  moderately_conservative: "Moderately Conservative",
  moderate: "Moderate",
  moderately_aggressive: "Moderately Aggressive",
  aggressive: "Aggressive",
};

export function isRiskLevel(v: unknown): v is RiskLevel {
  return typeof v === "string" && (RISK_LEVELS as readonly string[]).includes(v);
}
