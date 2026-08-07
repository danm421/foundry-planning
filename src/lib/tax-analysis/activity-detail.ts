import type { TaxReturnFacts, BusinessFacts, K1Facts } from "@/lib/schemas/tax-return-facts";
import { fmtUsd } from "./format";

/**
 * Gross-to-net detail for every business, rental and pass-through activity on
 * the return — the block that answers "what did this actually take in?".
 *
 * `income.scheduleCNet` / `income.scheduleENet` and the income-composition
 * table carry only the NET. A rental that collected $19,600 of rent and nets to
 * a $6,141 loss after depreciation renders there as a single negative number,
 * visually identical to a return with no rental at all — and the $19,600 that
 * actually arrived in the bank has nowhere to appear. Same for a Schedule C
 * whose gross receipts vanish behind its net profit.
 *
 * The `cashFlow` memo is the point of the exercise: depreciation is a NON-CASH
 * deduction, so `net + depreciation` is roughly what the activity produced in
 * cash. That is the loss-on-paper / positive-in-cash case this app exists to
 * model, and it is invisible from the net alone.
 */

export type ActivityLineVariant = "primary" | "detail" | "total" | "memo";

export interface ActivityLine {
  label: string;
  /** Expenses and deductions are already negated — renderers never re-sign. */
  amount: number;
  variant: ActivityLineVariant;
}

export interface ActivityDetail {
  /** Stable React key; unique across the returned array. */
  key: string;
  title: string;
  subtitle: string | null;
  lines: ActivityLine[];
  /** Net + depreciation, when both are known. Null for a K-1, whose boxes are
   *  already allocated nets with no depreciation of their own to add back. */
  cashFlow: number | null;
  /** §469 loss the return could NOT use this year (Form 8582). Positive, and
   *  null when absent or zero — a future-year tax asset, not a current figure. */
  suspendedPassiveLoss: number | null;
}

const K1_TYPE_LABEL = {
  s_corp: "S-corp K-1",
  partnership: "Partnership K-1",
  estate_trust: "Estate/trust K-1",
} as const;

/** Pushes only when the figure was extracted — a null component is absent from
 *  the return, which is not the same claim as a zero. */
function push(lines: ActivityLine[], label: string, amount: number | null, variant: ActivityLineVariant) {
  if (amount != null) lines.push({ label, amount, variant });
}

/** Facts store outflows as positive magnitudes; the report shows them signed. */
const neg = (v: number | null) => (v == null ? null : -v);

function scheduleCActivity(b: BusinessFacts, index: number): ActivityDetail | null {
  const lines: ActivityLine[] = [];
  push(lines, "Gross receipts", b.grossReceipts, "primary");
  push(lines, "Total expenses", neg(b.totalExpenses), "primary");
  push(lines, "Depreciation (non-cash)", neg(b.depreciation), "detail");
  push(lines, "Net profit", b.netProfit, "total");
  if (lines.length === 0) return null;
  return {
    key: b.entityId ?? `business-${index}`,
    title: b.name ?? "Schedule C business",
    subtitle: "Schedule C",
    lines,
    cashFlow: b.netProfit != null && b.depreciation != null ? b.netProfit + b.depreciation : null,
    suspendedPassiveLoss: null,
  };
}

function scheduleEActivity(facts: TaxReturnFacts): ActivityDetail | null {
  const e = facts.income.scheduleE;
  if (!e) return null;
  const lines: ActivityLine[] = [];
  push(lines, "Rents received", e.grossRents, "primary");
  push(lines, "Total expenses", neg(e.totalExpenses), "primary");
  push(lines, "Depreciation (non-cash)", neg(e.depreciation), "detail");
  push(lines, "Mortgage interest", neg(e.mortgageInterest), "detail");
  push(lines, "Property taxes", neg(e.propertyTaxes), "detail");
  if (lines.length === 0) return null;

  // The net is the FILED Schedule 1 line 5, never gross minus expenses:
  // personal-use exclusions and the §280A vacation-home limit routinely break
  // that identity, and a derived total that disagrees with the return is worse
  // than no total at all.
  const net = facts.income.scheduleENet;
  push(lines, "Net taxable", net, "total");

  return {
    key: "schedule-e",
    title: "Rental real estate",
    subtitle: "Schedule E",
    lines,
    cashFlow: net != null && e.depreciation != null ? net + e.depreciation : null,
    suspendedPassiveLoss: e.suspendedPassiveLoss ? e.suspendedPassiveLoss : null,
  };
}

function k1Activity(k: K1Facts, index: number): ActivityDetail | null {
  const lines: ActivityLine[] = [];
  push(lines, "Ordinary business income", k.ordinaryBusinessIncome, "primary");
  push(lines, "Rental income", k.rentalIncome, "primary");
  push(lines, "Guaranteed payments", k.guaranteedPayments, "primary");
  push(lines, "Section 179 deduction", neg(k.section179), "detail");
  if (lines.length === 0) return null;
  const typeLabel = k.entityType ? K1_TYPE_LABEL[k.entityType] : "Schedule K-1";
  return {
    key: k.entityId ?? `k1-${index}`,
    title: k.entityName ?? "Schedule K-1 entity",
    subtitle: k.ein ? `${typeLabel} · EIN ${k.ein}` : typeLabel,
    lines,
    cashFlow: null,
    suspendedPassiveLoss: null,
  };
}

/** Schedule 1 line order: Schedule C (line 3), Schedule E (line 5), then the
 *  K-1s that feed line 5's pass-through half. Null when the return has no
 *  business, rental or pass-through activity at all. */
export function buildActivityDetail(facts: TaxReturnFacts): ActivityDetail[] | null {
  const out: ActivityDetail[] = [
    ...facts.businesses.map(scheduleCActivity),
    scheduleEActivity(facts),
    ...facts.k1s.map(k1Activity),
  ].filter((a): a is ActivityDetail => a !== null);
  return out.length > 0 ? out : null;
}

/** Formatted rows — shared by the report view and the PDF so the two surfaces
 *  can't drift, the same contract `deductionDetailRows` has. Memos append below
 *  the net because they are commentary on it, not terms of its arithmetic. */
export function activityDetailRows(
  a: ActivityDetail,
): Array<{ label: string; value: string; variant: ActivityLineVariant }> {
  const rows = a.lines.map((l) => ({ label: l.label, value: fmtUsd(l.amount), variant: l.variant }));
  if (a.cashFlow != null) {
    rows.push({ label: "Cash flow before depreciation", value: fmtUsd(a.cashFlow), variant: "memo" });
  }
  if (a.suspendedPassiveLoss != null) {
    rows.push({
      label: "Suspended passive loss carried forward",
      value: fmtUsd(a.suspendedPassiveLoss),
      variant: "memo",
    });
  }
  return rows;
}
