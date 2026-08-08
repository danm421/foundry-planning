import {
  MC_WARN_THRESHOLD,
  MC_CRIT_THRESHOLD,
  LIQUIDITY_RUNWAY_MIN_YEARS,
} from "@/lib/alerts";
import type { Signal, SignalInput } from "./types";

export function planSignals(input: SignalInput): Signal[] {
  const { plan, clientId } = input;
  const out: Signal[] = [];

  if (plan.mcSuccessRate != null && plan.mcSuccessRate < MC_WARN_THRESHOLD) {
    const pct = Math.round(plan.mcSuccessRate * 100);
    out.push({
      id: "plan.confidence_low",
      domain: "plan",
      severity: plan.mcSuccessRate < MC_CRIT_THRESHOLD ? "critical" : "watch",
      title: `Plan confidence ${pct}%`,
      detail: `Monte Carlo success is ${pct}%, below the ${Math.round(MC_WARN_THRESHOLD * 100)}% threshold.`,
      numbers: { successRate: plan.mcSuccessRate },
      href: `/clients/${clientId}/cashflow/monte-carlo`,
      estimatedImpact: null,
    });
  }

  if (plan.currentYearNetOutflow > 0) {
    const runway = plan.liquidPortfolio / plan.currentYearNetOutflow;
    if (runway < LIQUIDITY_RUNWAY_MIN_YEARS) {
      out.push({
        id: "plan.liquidity_runway_low",
        domain: "plan",
        severity: "watch",
        title: "Short liquidity runway",
        detail: `Liquid assets cover about ${runway.toFixed(1)} years of this year's net outflow, under the ${LIQUIDITY_RUNWAY_MIN_YEARS}-year floor.`,
        numbers: { runway, liquidPortfolio: plan.liquidPortfolio },
        href: `/clients/${clientId}/cashflow`,
        estimatedImpact: null,
      });
    }
  }

  if (plan.minNetWorth <= 0) {
    out.push({
      id: "plan.negative_net_worth",
      domain: "plan",
      severity: "critical",
      title: "Net worth is projected to reach zero",
      detail: "At least one plan year projects a net worth at or below zero.",
      numbers: { minNetWorth: plan.minNetWorth },
      href: `/clients/${clientId}/cashflow`,
      estimatedImpact: null,
    });
  }

  if (plan.fundingScore < 1) {
    out.push({
      id: "plan.funding_shortfall",
      domain: "plan",
      severity: "critical",
      title: "Plan is underfunded",
      detail: `The funding score is ${plan.fundingScore.toFixed(2)}; 1.0 is the funded boundary.`,
      numbers: { fundingScore: plan.fundingScore },
      href: `/clients/${clientId}/cashflow`,
      estimatedImpact: null,
    });
  }

  return out;
}
