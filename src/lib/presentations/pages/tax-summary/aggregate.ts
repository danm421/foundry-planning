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

/** Roth/pre-tax/taxable snapshot at the primary client's retirement year. Roth
 *  includes full roth_ira balances + the designated-Roth sub-portion inside
 *  401k/403b (`rothValueEoY`). Accounts created mid-projection that are absent
 *  from `clientData.accounts` are not counted (accepted; see spec). */
export function computeRetirementComposition(
  years: ProjectionYear[],
  clientData: ClientData,
): RetirementComposition | null {
  const by = birthYear(clientData.client.dateOfBirth);
  if (by == null) return null;
  const retYear = by + clientData.client.retirementAge;
  const py = years.find((y) => y.year === retYear) ?? years[0];
  if (!py) return null;

  let roth = 0, preTax = 0, taxable = 0;
  for (const a of clientData.accounts) {
    const led = py.accountLedgers[a.id];
    const ev = led?.endingValue ?? 0;
    if (a.category === "retirement") {
      const rothPortion =
        a.subType === "roth_ira" ? ev
        : a.subType === "401k" || a.subType === "403b" ? (led?.rothValueEoY ?? 0)
        : 0;
      roth += rothPortion;
      preTax += ev - rothPortion;
    } else if (a.category === "taxable") {
      taxable += ev;
    }
  }
  return { year: py.year, roth, preTax, taxable, total: roth + preTax + taxable };
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

export interface BracketTimelinePoint {
  year: number;
  rate: number;
  isLow: boolean;
}
export function buildBracketTimeline(rows: TaxBracketRow[], lowThreshold: number): BracketTimelinePoint[] {
  return rows.map((r) => ({ year: r.year, rate: r.marginalRate, isLow: r.marginalRate < lowThreshold }));
}
