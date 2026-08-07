import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { fmtUsd, fmtPct } from "./format";
import { grossForKey, type GrossIncome } from "./gross-income";

/** Derived display blocks for the report + PDF. Computed per-request inside
 *  buildTaxAnalysis (never persisted); the PDF route receives `analysis`
 *  only — not `facts` — so both surfaces read these instead of re-deriving. */

export interface IncomeCompositionRow {
  key: string;
  label: string;
  /** As filed — the figure that reaches 1040 line 9. */
  amount: number;
  /** What the source took in, before basis recovery and business/rental
   *  expenses. Equals `amount` for every source with nothing to gross up. */
  gross: number;
  /** Fraction of GROSS income (sign preserved), not of line 9 — a rental loss
   *  netted into line 9 is what made wages read 105% of it. Null when the
   *  denominator is unavailable or not positive. */
  pctOfGross: number | null;
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

export function buildIncomeComposition(
  facts: TaxReturnFacts,
  gross: GrossIncome,
): IncomeCompositionRow[] | null {
  const present: Array<{ key: string; label: string; amount: number; gross: number }> = [];
  for (const row of INCOME_ROWS) {
    const amount = row.get(facts);
    if (amount != null) {
      present.push({ key: row.key, label: row.label, amount, gross: grossForKey(gross, row.key, amount) });
    }
  }
  if (present.length === 0) return null;
  const denom = gross.total ?? present.reduce((s, r) => s + r.gross, 0);
  const usePct = denom > 0;
  return present.map((r) => ({ ...r, pctOfGross: usePct ? r.gross / denom : null }));
}

/** True when at least one source's gross differs from what it contributed to
 *  line 9 — i.e. when a Gross column would say something the Amount column
 *  doesn't. Shared so the report view and the PDF can't disagree about whether
 *  the table is three columns wide or four. */
export function hasGrossColumn(rows: IncomeCompositionRow[]): boolean {
  return rows.some((r) => r.gross !== r.amount);
}

/** Total row for the Income composition table — shared by the report view and
 *  the PDF so the two can't drift. Returns null when 1040 line 9 wasn't
 *  extracted (no total row rendered; we never pass a summed-rows figure off as
 *  an authoritative total). % is 100% for a positive total, em dash for a
 *  zero/negative (loss-year) total, mirroring buildIncomeComposition's usePct
 *  guard — and it is the GROSS total that anchors the percentages. */
export function incomeCompositionTotal(
  totalIncome: number | null,
  grossTotal: number | null,
): { amount: string; gross: string; pct: string } | null {
  if (totalIncome == null) return null;
  const g = grossTotal ?? totalIncome;
  return { amount: fmtUsd(totalIncome), gross: fmtUsd(g), pct: g > 0 ? fmtPct(1) : "—" };
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
