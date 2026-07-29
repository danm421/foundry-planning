import { RISK_LEVEL_LABELS, type RiskLevel } from "@/lib/risk-levels";

interface RiskLevelBadgeProps {
  level: RiskLevel | null;
  score: number | null;
}

/**
 * Compact "level + score" readout for a household's composite risk profile.
 * Owns its own null case -- a household with no profile yet (the common case
 * right after onboarding) reads as a muted "Not established" rather than a
 * blank cell, so every call site gets that fallback for free.
 */
export function RiskLevelBadge({ level, score }: RiskLevelBadgeProps) {
  if (!level) {
    return <span className="text-ink-3">Not established</span>;
  }
  return (
    <span className="inline-flex items-baseline gap-1.5 text-sm text-ink">
      <span className="font-medium">{RISK_LEVEL_LABELS[level]}</span>
      {score !== null && <span className="tabular text-ink-3">{score}</span>}
    </span>
  );
}
