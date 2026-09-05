import type { ProjectionYear } from "./types";

/** The seven buckets the tax engine distinguishes. Mirrors the DB's
 *  `income_tax_type` enum — keep the two in lockstep. */
export type IncomeTaxType =
  | "earned_income"
  | "ordinary_income"
  | "dividends"
  | "capital_gains"
  | "stcg"
  | "qbi"
  | "tax_exempt";

/** One advisor-entered adjustment: income that already happened, which the tax
 *  engine must see and the cash flow must not. */
export interface TaxAdjustmentRow {
  id: string;
  taxType: IncomeTaxType;
  name: string | null;
  /** SIGNED. Negative removes income the plan over-counts. */
  annualAmount: number;
  growthRate: number;
  startYear: number;
  endYear: number;
  withheldMode: "none" | "amount" | "percent";
  /** Dollars when mode is "amount"; a 0..1 fraction when "percent". */
  withheldValue: number;
}

export interface ResolvedTaxAdjustments {
  byTaxType: Record<IncomeTaxType, number>;
  /** Everything except `tax_exempt` — what folds into the `taxableIncome` scalar. */
  taxableTotal: number;
  /** Long-term slice of `taxableTotal`, for `capitalGainsInTaxableIncome`. */
  capitalGainsLt: number;
  /** Short-term slice of `taxableTotal`, for `capitalGainsInTaxableIncome`. */
  capitalGainsSt: number;
  /** Tax already withheld or paid, summed over POSITIVE rows only. Unclamped —
   *  the caller clamps against the year's actual tax. */
  alreadyPaid: number;
  bySource: Record<string, { type: string; amount: number }>;
}

function emptyByTaxType(): Record<IncomeTaxType, number> {
  return {
    earned_income: 0,
    ordinary_income: 0,
    dividends: 0,
    capital_gains: 0,
    stcg: 0,
    qbi: 0,
    tax_exempt: 0,
  };
}

/**
 * Resolve every adjustment active in `year` into the engine's tax buckets.
 *
 * Deliberately NOT prorated for a partial first year: a scheduled item
 * represents a future stream, but an adjustment represents a transaction that
 * already happened, in full. The entered amount is the amount.
 */
export function resolveTaxAdjustmentsForYear(
  rows: TaxAdjustmentRow[] | undefined,
  year: number,
): ResolvedTaxAdjustments {
  const out: ResolvedTaxAdjustments = {
    byTaxType: emptyByTaxType(),
    taxableTotal: 0,
    capitalGainsLt: 0,
    capitalGainsSt: 0,
    alreadyPaid: 0,
    bySource: {},
  };
  if (!rows?.length) return out;

  for (const r of rows) {
    if (year < r.startYear || year > r.endYear) continue;

    const amount = r.annualAmount * Math.pow(1 + r.growthRate, year - r.startYear);
    if (amount === 0) continue;

    out.byTaxType[r.taxType] += amount;
    out.bySource[`tax_adjustment:${r.id}`] = { type: r.taxType, amount };

    // Tax-exempt income raises `taxDetail.taxExempt` only; it never enters the
    // taxable scalar. It deliberately does NOT raise `taxExemptInterest`, which
    // is the muni-interest subset used for IRMAA MAGI — a generic tax-exempt
    // adjustment is not necessarily muni interest.
    if (r.taxType !== "tax_exempt") out.taxableTotal += amount;
    if (r.taxType === "capital_gains") out.capitalGainsLt += amount;
    if (r.taxType === "stcg") out.capitalGainsSt += amount;

    // A negative adjustment removes income; there is no withholding to reverse,
    // and a percent of a negative number is meaningless.
    if (amount > 0) {
      if (r.withheldMode === "amount") out.alreadyPaid += r.withheldValue;
      else if (r.withheldMode === "percent") out.alreadyPaid += amount * r.withheldValue;
    }
  }

  return out;
}

/** Net adjustment income booked in a projection year, read back out of the
 *  taxDetail drill-down map. Used by the income-tax report column. */
export function sumTaxAdjustments(taxDetail: ProjectionYear["taxDetail"]): number {
  if (!taxDetail) return 0;
  let sum = 0;
  for (const [key, entry] of Object.entries(taxDetail.bySource)) {
    if (key.startsWith("tax_adjustment:")) sum += entry.amount;
  }
  return sum;
}
