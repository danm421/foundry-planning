import type { ProjectionYear, ClientData } from "@/engine/types";
import type { TaxBracketRow } from "@/lib/tax/bracket";

// ── Formatting (single source; page-pdf + chart import these) ────────────────
export function fmtUsd(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}
export function fmtPct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

// ── Lifetime totals ─────────────────────────────────────────────────────────
export interface TaxLifetimeTotals {
  lifetimeFederal: number;
  lifetimeState: number;
  lifetimeCapGains: number;
  lifetimeTotal: number;
  grossIncome: number;
  effectiveRate: number;
}

export function computeLifetimeTotals(years: ProjectionYear[]): TaxLifetimeTotals {
  let lifetimeFederal = 0, lifetimeState = 0, lifetimeCapGains = 0, lifetimeTotal = 0, grossIncome = 0;
  for (const y of years) {
    const flow = y.taxResult?.flow;
    if (flow) {
      lifetimeFederal += flow.totalFederalTax;
      lifetimeState += flow.stateTax;
      lifetimeCapGains += flow.capitalGainsTax;
      lifetimeTotal += flow.totalTax;
    }
    grossIncome += y.taxResult?.income.grossTotalIncome ?? 0;
  }
  const effectiveRate = grossIncome > 0 ? lifetimeTotal / grossIncome : 0;
  return { lifetimeFederal, lifetimeState, lifetimeCapGains, lifetimeTotal, grossIncome, effectiveRate };
}
