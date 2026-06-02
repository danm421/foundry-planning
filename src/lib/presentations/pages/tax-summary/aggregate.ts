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

// ── Bracket exposure ────────────────────────────────────────────────────────
export interface BracketExposure {
  yearsBelowLow: number;
  yearsAboveHigh: number;
  lowThreshold: number;
  highThreshold: number;
  minRate: number | null;
  maxRate: number | null;
}

export function computeBracketExposure(
  rows: TaxBracketRow[],
  lowThreshold: number,
  highThreshold: number,
): BracketExposure {
  let yearsBelowLow = 0, yearsAboveHigh = 0;
  let minRate: number | null = null, maxRate: number | null = null;
  for (const r of rows) {
    if (r.marginalRate < lowThreshold) yearsBelowLow++;
    if (r.marginalRate > highThreshold) yearsAboveHigh++;
    minRate = minRate == null ? r.marginalRate : Math.min(minRate, r.marginalRate);
    maxRate = maxRate == null ? r.marginalRate : Math.max(maxRate, r.marginalRate);
  }
  return { yearsBelowLow, yearsAboveHigh, lowThreshold, highThreshold, minRate, maxRate };
}

// ── Tax-paid-by-year bars (hero chart) ──────────────────────────────────────
export interface TaxYearBar {
  year: number;
  federalOrdinary: number; // totalFederalTax − capitalGainsTax, clamped ≥ 0
  capGains: number;
  state: number;
  total: number;           // federalOrdinary + capGains + state
}

export function buildTaxPaidBars(years: ProjectionYear[]): TaxYearBar[] {
  const bars: TaxYearBar[] = [];
  for (const y of years) {
    const flow = y.taxResult?.flow;
    if (!flow) continue;
    const capGains = flow.capitalGainsTax;
    const federalOrdinary = Math.max(0, flow.totalFederalTax - capGains);
    const state = flow.stateTax;
    bars.push({ year: y.year, federalOrdinary, capGains, state, total: federalOrdinary + capGains + state });
  }
  return bars;
}
