import type { MonteCarloSummary } from "@foundry/engine";

export type RiskTone = "emerald" | "amber" | "rose";

export interface TopRisk {
  label: string;
  tone: RiskTone;
}

interface ClientLike {
  client: {
    planEndAge: number;
  };
}

interface PlanSettingsLike {
  inflationRate: number;
}

export function computeTopRisks(
  summary: MonteCarloSummary,
  clientData: ClientLike,
  planSettings: PlanSettingsLike,
): TopRisk[] {
  const risks: TopRisk[] = [];

  if (planSettings.inflationRate > 0.035) {
    risks.push({ label: "High Inflation", tone: "amber" });
  }

  // "Early Bear Market" — at ~10 years in, the 5th-percentile balance is
  // below the plan's starting median. Clamp the lookup to the last byYear
  // entry for short plans.
  const n = summary.byYear.length;
  if (n > 0) {
    const yearTenIdx = Math.min(10, n - 1);
    const startMedian = summary.byYear[0].balance.p50;
    const yearTenP5 = summary.byYear[yearTenIdx].balance.p5;
    if (yearTenP5 < startMedian) {
      risks.push({ label: "Early Bear Market", tone: "rose" });
    }
  }

  if (clientData.client.planEndAge > 95) {
    risks.push({ label: "Longevity", tone: "amber" });
  }

  return risks;
}
