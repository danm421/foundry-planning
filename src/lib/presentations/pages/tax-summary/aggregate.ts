import type { ProjectionYear, ClientData } from "@/engine/types";
import type { TaxBracketRow } from "@/lib/tax/bracket";
import { assetsByTaxTypeAt } from "@/lib/presentations/shared/tax-type-composition";

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
//
// The KPI strip prints these side by side under one total, so they have to be
// DISJOINT and they have to add up. Two things stopped them:
//
//  - `capitalGainsTax` is a slice *inside* `totalFederalTax`, not a sibling of
//    it, so a reader adding the tiles double-counted it. The strip renders
//    `lifetimeFederalOrdinary` (federal net of the gains slice) instead;
//    `lifetimeFederal` stays here as the whole federal bill it is derived from.
//  - Payroll tax (FICA) is inside the engine's `totalTax` — the same figure the
//    Cash Flow page's "Taxes" row shows — but was itemized nowhere, so the
//    total ran ahead of its own parts through every working year.
//
// Invariant, asserted in the tests:
//   federalOrdinary + capGains + state + payroll === total
export interface TaxLifetimeTotals {
  /** Whole federal bill, capital-gains tax included. */
  lifetimeFederal: number;
  /** Federal net of the capital-gains slice — the strip's "Federal (ordinary)". */
  lifetimeFederalOrdinary: number;
  lifetimeState: number;
  lifetimeCapGains: number;
  /** FICA / self-employment payroll tax. */
  lifetimePayroll: number;
  lifetimeTotal: number;
  grossIncome: number;
  effectiveRate: number;
}

export function computeLifetimeTotals(years: ProjectionYear[]): TaxLifetimeTotals {
  let lifetimeFederal = 0, lifetimeState = 0, lifetimeCapGains = 0;
  let lifetimePayroll = 0, lifetimeTotal = 0, grossIncome = 0;
  for (const y of years) {
    const flow = y.taxResult?.flow;
    if (flow) {
      lifetimeFederal += flow.totalFederalTax;
      lifetimeState += flow.stateTax;
      lifetimeCapGains += flow.capitalGainsTax;
      lifetimePayroll += flow.fica;
      lifetimeTotal += flow.totalTax;
    }
    grossIncome += y.taxResult?.income.grossTotalIncome ?? 0;
  }
  const effectiveRate = grossIncome > 0 ? lifetimeTotal / grossIncome : 0;
  // Not clamped: a refundable-credit year can push federal tax below the gains
  // slice, and clamping here would break the sum-to-total invariant.
  const lifetimeFederalOrdinary = lifetimeFederal - lifetimeCapGains;
  return {
    lifetimeFederal, lifetimeFederalOrdinary, lifetimeState, lifetimeCapGains,
    lifetimePayroll, lifetimeTotal, grossIncome, effectiveRate,
  };
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
  payroll: number;         // FICA / self-employment
  total: number;           // federalOrdinary + capGains + state + payroll
}

export function buildTaxPaidBars(years: ProjectionYear[]): TaxYearBar[] {
  const bars: TaxYearBar[] = [];
  for (const y of years) {
    const flow = y.taxResult?.flow;
    if (!flow) continue;
    const capGains = flow.capitalGainsTax;
    const federalOrdinary = Math.max(0, flow.totalFederalTax - capGains);
    const state = flow.stateTax;
    const payroll = flow.fica;
    bars.push({
      year: y.year, federalOrdinary, capGains, state, payroll,
      total: federalOrdinary + capGains + state + payroll,
    });
  }
  return bars;
}

// ── Account composition at retirement ───────────────────────────────────────
export interface RetirementComposition {
  year: number;
  roth: number;
  preTax: number;
  taxable: number;
  total: number;
}

function birthYear(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const y = Number(dob.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

/** Roth/pre-tax/taxable snapshot at the primary client's retirement year —
 *  the same split the Retirement Summary prints, from the same helper. */
export function computeRetirementComposition(
  years: ProjectionYear[],
  clientData: ClientData,
): RetirementComposition | null {
  const by = birthYear(clientData.client.dateOfBirth);
  if (by == null) return null;
  const retYear = by + clientData.client.retirementAge;
  const py = years.find((y) => y.year === retYear) ?? years[0];
  if (!py) return null;
  return { year: py.year, ...assetsByTaxTypeAt(py, clientData.accounts) };
}

// ── Opportunity rows ────────────────────────────────────────────────────────
/** Realized LTCG (taxDetail.capitalGains) at or above this counts as an "event"
 *  worth surfacing on the opportunities page. Fixed for v1 (see spec). */
export const LARGE_GAIN_THRESHOLD = 25_000;

export interface RothConversionRow {
  year: number;
  gross: number;
  taxable: number;
  marginalRate: number;
}
export function buildRothConversionRows(rows: TaxBracketRow[]): RothConversionRow[] {
  return rows
    .filter((r) => r.conversionGross > 0)
    .map((r) => ({ year: r.year, gross: r.conversionGross, taxable: r.conversionTaxable, marginalRate: r.marginalRate }));
}

export interface IrmaaRow {
  year: number;
  surcharge: number;
}
export function buildIrmaaRows(years: ProjectionYear[]): IrmaaRow[] {
  const out: IrmaaRow[] = [];
  for (const y of years) {
    const s = y.medicare?.totalIrmaaSurcharge ?? 0;
    if (s > 0) out.push({ year: y.year, surcharge: s });
  }
  return out;
}

export interface CapGainsEventRow {
  year: number;
  gain: number;
  tax: number;
}
export function buildCapGainsEvents(years: ProjectionYear[]): CapGainsEventRow[] {
  const out: CapGainsEventRow[] = [];
  for (const y of years) {
    const gain = y.taxDetail?.capitalGains ?? 0;
    if (gain >= LARGE_GAIN_THRESHOLD) {
      out.push({ year: y.year, gain, tax: y.taxResult?.flow.capitalGainsTax ?? 0 });
    }
  }
  return out;
}
