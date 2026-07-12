import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { fmtUsd } from "./format";

/** Derived display blocks for the report + PDF. Computed per-request inside
 *  buildTaxAnalysis (never persisted); the PDF route receives `analysis`
 *  only — not `facts` — so both surfaces read these instead of re-deriving. */

export interface IncomeCompositionRow {
  key: string;
  label: string;
  amount: number;
  /** Fraction of total income (sign preserved); null when the denominator
   *  is unavailable or not positive. */
  pctOfTotal: number | null;
}

export interface ScheduleADetail {
  saltPaid: number | null;
  saltDeducted: number | null;
  mortgageInterest: number | null;
  charitableCash: number | null;
  charitableNonCash: number | null;
  medical: number | null;
  /** saltPaid − saltDeducted when both present and positive; else null. */
  saltLostToCap: number | null;
}

export interface DeductionDetail {
  deductionTaken: "standard" | "itemized" | null;
  deductionAmount: number | null;
  qbiDeduction: number | null;
  scheduleA: ScheduleADetail | null;
}

/** 1040 order; taxable amounts (4b/5b/6b) to match line-9 arithmetic. */
const INCOME_ROWS: Array<{ key: string; label: string; get: (f: TaxReturnFacts) => number | null }> = [
  { key: "wages", label: "Wages", get: (f) => f.income.wages },
  { key: "taxableInterest", label: "Taxable interest", get: (f) => f.income.taxableInterest },
  { key: "dividends", label: "Dividends", get: (f) => f.income.ordinaryDividends },
  { key: "ira", label: "IRA distributions", get: (f) => f.income.iraDistributionsTaxable },
  { key: "pensions", label: "Pensions", get: (f) => f.income.pensionsTaxable },
  { key: "socialSecurity", label: "Social Security (taxable)", get: (f) => f.income.ssBenefitsTaxable },
  { key: "capitalGains", label: "Capital gain/loss", get: (f) => f.income.capitalGainOrLoss },
  { key: "business", label: "Business (Sch C)", get: (f) => f.income.scheduleCNet },
  { key: "rental", label: "Rental / passthrough (Sch E)", get: (f) => f.income.scheduleENet },
  { key: "unemployment", label: "Unemployment", get: (f) => f.income.unemployment },
  { key: "other", label: "Other income", get: (f) => f.income.otherIncome },
];

export function buildIncomeComposition(facts: TaxReturnFacts): IncomeCompositionRow[] | null {
  const present: Array<{ key: string; label: string; amount: number }> = [];
  for (const row of INCOME_ROWS) {
    const amount = row.get(facts);
    if (amount != null) present.push({ key: row.key, label: row.label, amount });
  }
  if (present.length === 0) return null;
  const denom = facts.income.totalIncome ?? present.reduce((s, r) => s + r.amount, 0);
  const usePct = denom > 0;
  return present.map((r) => ({ ...r, pctOfTotal: usePct ? r.amount / denom : null }));
}

export function buildDeductionDetail(facts: TaxReturnFacts): DeductionDetail | null {
  const d = facts.deductions;
  const a = d.scheduleA;
  const scheduleA: ScheduleADetail | null = a
    ? {
        ...a,
        saltLostToCap:
          a.saltPaid != null && a.saltDeducted != null && a.saltPaid - a.saltDeducted > 0
            ? a.saltPaid - a.saltDeducted
            : null,
      }
    : null;
  if (d.deductionTaken == null && d.deductionAmount == null && d.qbiDeduction == null && scheduleA == null) {
    return null;
  }
  return {
    deductionTaken: d.deductionTaken,
    deductionAmount: d.deductionAmount,
    qbiDeduction: d.qbiDeduction,
    scheduleA,
  };
}

/** Null-skipping label/value rows — shared by the report view and the PDF so
 *  the two surfaces can't drift. */
export function deductionDetailRows(d: DeductionDetail): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [];
  if (d.deductionTaken) {
    rows.push({ label: "Deduction taken", value: d.deductionTaken === "standard" ? "Standard" : "Itemized" });
  }
  if (d.deductionAmount != null) rows.push({ label: "Deduction amount (12)", value: fmtUsd(d.deductionAmount) });
  if (d.qbiDeduction != null) rows.push({ label: "QBI deduction (13)", value: fmtUsd(d.qbiDeduction) });
  const a = d.scheduleA;
  if (a) {
    if (a.saltPaid != null) rows.push({ label: "State & local taxes paid", value: fmtUsd(a.saltPaid) });
    if (a.saltDeducted != null) rows.push({ label: "SALT deducted (after cap)", value: fmtUsd(a.saltDeducted) });
    if (a.saltLostToCap != null) rows.push({ label: "SALT lost to the cap", value: fmtUsd(a.saltLostToCap) });
    if (a.mortgageInterest != null) rows.push({ label: "Mortgage interest", value: fmtUsd(a.mortgageInterest) });
    if (a.charitableCash != null) rows.push({ label: "Charitable — cash", value: fmtUsd(a.charitableCash) });
    if (a.charitableNonCash != null) rows.push({ label: "Charitable — non-cash", value: fmtUsd(a.charitableNonCash) });
    if (a.medical != null) rows.push({ label: "Medical (after AGI floor)", value: fmtUsd(a.medical) });
  }
  return rows;
}
