import type { ClientData, ClientInfo, ProjectionYear } from "@/engine";
import type { Expense, Income } from "@/engine/types";
import { isHeldFlatLiability } from "@/engine/liability-kind";
import { buildLiabilitySchedule } from "@/engine/liability-schedules";
import { retirementMonthWindow } from "@/engine/retirement-proration";
import { deflator, householdLiquidAccountIds, type DollarBasis } from "./monthly-cash-flow";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export interface MonthRow {
  /** 1-12. */
  month: number;
  /** "January" … "December". */
  label: string;
  income: number;
  portfolioDraw: number;
  taxes: number;
  debt: number;
  savings: number;
  /** insurance + realEstate + other, matching the year table's "Other" column. */
  other: number;
  living: number;
  /** income + portfolioDraw − taxes − debt − savings − other − living − surplusSpent */
  net: number;
  /** Household cash at the END of this month: the household's opening liquid
   *  balance for the year, plus every month's net up to and including this one. */
  cashOnHand: number;
}

/**
 * Spread one annual amount across twelve months.
 *
 * `month` null → an even split. `month` 1-12 → the whole amount in that month.
 *
 * EXACT BY CONSTRUCTION, not by tolerance — see `spreadRange`.
 *
 * Exported for its own unit test: this exactness is the module's contract at the
 * single-row level, and it is the only level where `toBe` is achievable — summing
 * ACROSS rows re-associates the same terms and drifts in the last bits.
 */
export function spread(total: number, month: number | null | undefined): number[] {
  if (month != null && month >= 1 && month <= 12) return spreadRange(total, month, month);
  return spreadRange(total, 1, 12);
}

/**
 * Spread one amount evenly across months `first`..`last` (1-12).
 *
 * Twelve additions of `total / 12` do not always return `total` in binary
 * floating point, so every month but the last takes the rounded share and the
 * last takes whatever is left.
 */
export function spreadRange(total: number, first: number, last: number): number[] {
  const out = new Array(12).fill(0);
  const count = last - first + 1;
  const each = total / count;
  let assigned = 0;
  for (let m = first; m < last; m++) {
    out[m - 1] = each;
    assigned += each;
  }
  out[last - 1] = total - assigned;
  return out;
}

/**
 * The months of `year` a plan row's amount belongs in, as a 12-month split.
 *
 *  · `paymentMonth` — the advisor's "paid in" month — takes the whole amount.
 *  · `paidByMonth`, when the engine reports one, shapes it: Social Security
 *    in its claim year starts in the entitlement month, and a survivor year
 *    splits at the survivor's own claim (`income.monthlyBySource`).
 *  · A retirement-linked row in the retirement year runs only in the months
 *    `retirementMonthWindow` gives it — the months the engine prorated it to.
 *  · Anything else, including a key with no plan row, spreads evenly.
 */
export function placeInMonths(
  total: number,
  row: Income | Expense | undefined,
  year: number,
  client: ClientInfo,
  paidByMonth?: number[],
): number[] {
  if (row?.paymentMonth != null) return spread(total, row.paymentMonth);
  if (paidByMonth) return spreadLike(total, paidByMonth);
  if (!row) return spreadRange(total, 1, 12);
  const { first, last } = retirementMonthWindow(row, year, client);
  // A row that starts at one spouse's retirement and ends at the other's can
  // leave no months; the money still lands somewhere.
  return first <= last ? spreadRange(total, first, last) : spreadRange(total, 1, 12);
}

/** `total` in the proportions of `weights`; the last paid month takes the
 *  remainder, so the split adds back to `total` exactly. */
function spreadLike(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return spreadRange(total, 1, 12);
  const last = weights.findLastIndex((w) => w > 0);
  let assigned = 0;
  return weights.map((w, i) => {
    if (i === last) return total - assigned;
    const part = (total * w) / sum;
    assigned += part;
    return part;
  });
}

/** Spread a loan's annual payment across the months it actually paid. */
function spreadLoan(total: number, firstMonth: number, count: number): number[] {
  const out = new Array(12).fill(0);
  if (count <= 0) return out;
  const each = total / count;
  let assigned = 0;
  for (let i = 0; i < count - 1; i++) {
    const m = firstMonth - 1 + i;
    if (m > 11) break;
    out[m] = each;
    assigned += each;
  }
  const lastIdx = Math.min(firstMonth - 1 + count - 1, 11);
  out[lastIdx] += total - assigned;
  return out;
}

/**
 * Turn one projection year into twelve months.
 *
 * PRESENTATION ONLY. Every amount read here was already settled by the engine —
 * grown, inflated and PRORATED (`income.ts` stores `proratedTotal`). This
 * function never recomputes an amount; it only decides which month an amount
 * belongs to.
 *
 * Any `bySource` key with no matching row spreads evenly. That fallback must
 * stay the DEFAULT branch rather than an enumerated list of known synthetic
 * keys — a key added upstream would otherwise vanish from the month table while
 * still counting in the year.
 *
 * Reconciliation is guaranteed by a RESIDUAL TRUE-UP, not by trusting `bySource`
 * to be complete — it is not, and the ways it is incomplete are load-bearing
 * engine behaviour rather than bugs to route around. See `trueUp` below.
 */
export function buildMonthlyAllocation(
  year: ProjectionYear,
  clientData: ClientData,
  basis: DollarBasis,
): MonthRow[] {
  const k = deflator(year.year, basis, clientData.planSettings);

  const client = clientData.client;
  const incomeById = new Map(clientData.incomes.map((i) => [i.id, i]));

  const acc = {
    income: new Array(12).fill(0),
    taxes: new Array(12).fill(0),
    debt: new Array(12).fill(0),
    savings: new Array(12).fill(0),
    other: new Array(12).fill(0),
    living: new Array(12).fill(0),
    draw: new Array(12).fill(0),
    surplusSpent: new Array(12).fill(0),
  };

  const add = (target: number[], parts: number[]) => {
    for (let i = 0; i < 12; i++) target[i] += parts[i];
  };

  // How much of each category the per-row maps actually accounted for. The
  // year's own totals are the truth; these are only what `bySource` explained.
  let incomeExplained = 0;
  let livingExplained = 0;
  let otherExplained = 0;
  let debtExplained = 0;

  // ── Income: per row, in the months it was paid ────────────────────────────
  // A synthetic key with no matching row spreads evenly.
  for (const [key, amount] of Object.entries(year.income.bySource)) {
    add(
      acc.income,
      placeInMonths(
        amount * k,
        incomeById.get(key),
        year.year,
        client,
        year.income.monthlyBySource?.[key],
      ),
    );
    incomeExplained += amount;
  }

  // ── Expenses: per row, split into the column its type belongs to ──────────
  const byId = new Map(clientData.expenses.map((e) => [e.id, e]));
  for (const [key, amount] of Object.entries(year.expenses.bySource)) {
    const row = byId.get(key);
    const parts = placeInMonths(amount * k, row, year.year, client);
    if (row?.type === "living") {
      livingExplained += amount;
      add(acc.living, parts);
    } else {
      otherExplained += amount;
      add(acc.other, parts);
    }
  }

  // ── Debt: the months the loan genuinely paid ──────────────────────────────
  for (const [loanId, amount] of Object.entries(year.expenses.byLiability)) {
    const liab = clientData.liabilities.find((l) => l.id === loanId);
    // A held-flat liability (revolving, or no amortization term) has no real
    // schedule — the engine's own wrapper applies exactly this guard
    // (`liabilities.ts:38`) before ever calling `buildLiabilitySchedule`.
    const scheduleRow =
      liab && !isHeldFlatLiability(liab)
        ? buildLiabilitySchedule(liab).find((r) => r.year === year.year)
        : undefined;
    add(
      acc.debt,
      scheduleRow && scheduleRow.paymentCount > 0
        ? spreadLoan(amount * k, scheduleRow.firstPaymentMonth, scheduleRow.paymentCount)
        : spread(amount * k, null),
    );
    debtExplained += amount;
  }

  // ── Flat twelfths, by decision: no row carries a month for these ──────────
  add(acc.taxes, spread(year.expenses.taxes * k, null));
  add(acc.savings, spread(year.savings.total * k, null));
  add(acc.draw, spread(year.withdrawals.total * k, null));
  add(acc.surplusSpent, spread(year.expenses.discretionary * k, null));

  // ── The residual true-up ──────────────────────────────────────────────────
  // `bySource` is a DRILL-DOWN, not a decomposition: the engine folds real
  // dollars into a category's total without ever giving them a key, and
  // occasionally gives a key dollars that the total counts elsewhere. All of
  // these are deliberate:
  //   • RMD / notes-receivable / trust cash-in are inside `totalIncome` with no
  //     `income.bySource` key (`projection.ts:7102`).
  //   • Household cash gifts are inside `expenses.other` with no key (`:6977`).
  //   • `expenses.living` is net of `hypoFromExpenseReduction`, which never
  //     reaches `bySource` (`:6972`).
  //   • `withdrawal_penalty:*` keys are in `expenses.bySource` while the same
  //     dollars are folded into `expenses.taxes` (`:6945`, `:6959`).
  //   • `expenses.liabilities` is the HOUSEHOLD SHARE of debt service, while
  //     `byLiability` holds each loan's full payment (`:1660-1669`).
  // Truing each category up against the year's own total makes reconciliation
  // exact by construction rather than by fixture, and needs no knowledge of any
  // particular synthetic key. A residual is legitimately negative in the last
  // two cases; that is arithmetically what the year says, so it is not clamped.
  const trueUp = (target: number[], yearTotal: number, explained: number) =>
    add(target, spread((yearTotal - explained) * k, null));

  trueUp(acc.income, year.totalIncome, incomeExplained);
  trueUp(acc.living, year.expenses.living, livingExplained);
  trueUp(
    acc.other,
    year.expenses.insurance + year.expenses.realEstate + year.expenses.other,
    otherExplained,
  );
  trueUp(acc.debt, year.expenses.liabilities, debtExplained);
  // taxes / savings / portfolioDraw / surplusSpent are already flat twelfths of
  // their own year totals, so their residual is identically zero.

  // ── The running balance ───────────────────────────────────────────────────
  const householdIds = householdLiquidAccountIds([year], clientData);
  let cash = 0;
  for (const id of householdIds) cash += (year.accountLedgers[id]?.beginningValue ?? 0) * k;

  return MONTHS.map((label, i) => {
    const net =
      acc.income[i] +
      acc.draw[i] -
      acc.taxes[i] -
      acc.debt[i] -
      acc.savings[i] -
      acc.other[i] -
      acc.living[i] -
      acc.surplusSpent[i];
    cash += net;
    return {
      month: i + 1,
      label,
      income: acc.income[i],
      portfolioDraw: acc.draw[i],
      taxes: acc.taxes[i],
      debt: acc.debt[i],
      savings: acc.savings[i],
      other: acc.other[i],
      living: acc.living[i],
      net,
      cashOnHand: cash,
    };
  });
}
