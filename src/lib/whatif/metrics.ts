// The seven numbers every what-if reports, from the Solver's own summary
// helpers so a Claude answer matches the Solver screen. Pure.
import type { ProjectionResult } from "@/engine";
import type { ClientData } from "@/engine/types";
import { liquidPortfolioTotal } from "@/engine/monteCarlo/trial";
import { isTaxGrounded } from "@/lib/projection/is-tax-grounded";
import { retirementLivingExpenseTotal } from "@/lib/solver/max-spending-math";
import {
  estateHeirTotalsEol,
  lifetimeTaxes,
  yearsFullyFunded,
} from "@/lib/solver/solver-summary-metrics";

export interface WhatIfMetrics {
  /** Monte Carlo probability of success, 0–1. Null when Monte Carlo did not run — never 0. */
  successRate: number | null;
  /** Liquid portfolio in the plan's last year (portfolioAssets.liquidTotal). */
  endingPortfolio: number;
  lifetimeTax: number;
  /** What reaches heirs, already net of their income tax on inherited pre-tax balances. */
  netToHeirs: number | null;
  heirIncomeTax: number | null;
  yearsFullyFunded: number;
  firstShortfallYear: number | null;
}

export const METRIC_KEYS = [
  "successRate",
  "endingPortfolio",
  "lifetimeTax",
  "netToHeirs",
  "heirIncomeTax",
  "yearsFullyFunded",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

export function computeMetrics(
  tree: ClientData,
  projection: ProjectionResult,
  successRate: number | null,
): WhatIfMetrics {
  const years = projection.years;
  const heirs = estateHeirTotalsEol(projection, tree, {
    clientName: `${tree.client.firstName} ${tree.client.lastName}`.trim(),
    spouseName: tree.client.spouseName ?? null,
  });
  return {
    successRate,
    endingPortfolio: years.at(-1)?.portfolioAssets.liquidTotal ?? 0,
    lifetimeTax: lifetimeTaxes(years),
    netToHeirs: heirs?.netToHeirs ?? null,
    heirIncomeTax: heirs?.heirIncomeTax ?? null,
    yearsFullyFunded: yearsFullyFunded(years),
    firstShortfallYear: years.find((y) => liquidPortfolioTotal(y) < 0)?.year ?? null,
  };
}

export function metricDeltas(from: WhatIfMetrics, to: WhatIfMetrics): Partial<Record<MetricKey, number>> {
  const out: Partial<Record<MetricKey, number>> = {};
  for (const k of METRIC_KEYS) {
    const a = from[k];
    const b = to[k];
    if (typeof a === "number" && typeof b === "number") out[k] = b - a;
  }
  return out;
}

export const CAVEAT_NO_SPENDING =
  "No retirement living expense is entered, so the success rate says little: there is nothing to fund.";
export const CAVEAT_FLAT_TAX =
  "Taxes here use the plan's flat rates, not tax brackets. Don't present them as bracket-accurate.";
export const CAVEAT_MAX_ITERATIONS =
  "The solve stopped before it fully settled, so its answer is approximate.";
export const CAVEAT_IRMAA_SIBLING =
  "An IRMAA-capped Roth conversion runs alongside another conversion; the cap may not hold in that case. Check the Medicare figures.";
export const CAVEAT_NO_HEIR_TAX_RATE =
  "No heir income-tax rate is set, so net to heirs does not subtract tax on inherited IRAs and 401(k)s.";
export const CAVEAT_NEW_ACCOUNT_MC =
  "Monte Carlo grows accounts added in this what-if at their fixed rate, without market swings.";

const PRE_TAX_SUBTYPES = new Set(["traditional_ira", "ira", "401k", "403b", "sep_ira", "simple_ira"]);

export function caveatsFor(input: {
  tree: ClientData;
  metrics: WhatIfMetrics;
  solveStatus: string | null;
  addedAccounts: boolean;
}): string[] {
  const { tree, metrics } = input;
  const out: string[] = [];
  if (metrics.successRate !== null && retirementLivingExpenseTotal(tree) <= 0) out.push(CAVEAT_NO_SPENDING);
  if (!isTaxGrounded(tree)) out.push(CAVEAT_FLAT_TAX);
  if (input.solveStatus === "max-iterations") out.push(CAVEAT_MAX_ITERATIONS);
  const conversions = (tree.rothConversions ?? []).filter((c) => c.enabled !== false);
  if (conversions.length > 1 && conversions.some((c) => c.irmaaCapTier != null)) out.push(CAVEAT_IRMAA_SIBLING);
  const hasPreTax = tree.accounts.some((a) => a.category === "retirement" && PRE_TAX_SUBTYPES.has(a.subType));
  if (hasPreTax && !((tree.planSettings.irdTaxRate ?? 0) > 0)) out.push(CAVEAT_NO_HEIR_TAX_RATE);
  if (input.addedAccounts && metrics.successRate !== null) out.push(CAVEAT_NEW_ACCOUNT_MC);
  return out;
}
