// Per-year decomposition behind the Solver's Cash Flow → Income report: what
// funded each year, how much of it came out of the portfolio, and which tax
// treatment it came from.
//
// The income columns are anchored on the engine's own `totalIncome` scalar
// rather than re-summing `income.*`: `totalIncome` also folds in RMD, notes-
// receivable, equity-sale, and trust cash that the engine credits straight to
// checking (see projection.ts phase 14). Naming Social Security, salaries, and
// RMDs and taking Other Income as the *residual* keeps the row's arithmetic
// identical to the engine's, so `totalIncome - totalExpenses === netCashFlow`
// holds on every row and the table can't drift from the chart above it.
import type { Account, ProjectionYear } from "@/engine/types";
import { controllingFamilyMember } from "@/engine/ownership";
import {
  accountTaxBucket,
  type WithdrawalTaxBucket,
} from "@/lib/retirement/retirement-funding";

export type WithdrawalSourceKey = WithdrawalTaxBucket;

export interface WithdrawalSource {
  key: WithdrawalSourceKey;
  label: string;
}

/**
 * Draw sources in "spend-me-first" order, which is also the order the default
 * withdrawal strategy works through them. `preTax` absorbs 401(k)/403(b) draws
 * whole — the engine doesn't expose the designated-Roth slice of a plan
 * distribution, so that portion reads as pre-tax here (same simplification as
 * `lifetimeFunding`).
 */
export const WITHDRAWAL_SOURCES: readonly WithdrawalSource[] = [
  { key: "cash", label: "Cash" },
  { key: "taxable", label: "Taxable" },
  { key: "preTax", label: "Tax-Deferred" },
  { key: "roth", label: "Roth" },
];

export interface IncomeReportRow {
  year: number;
  ages: { client: number; spouse?: number };
  socialSecurity: number;
  salaries: number;
  /** Everything in the engine's Total Income that the named columns don't name. */
  otherIncome: number;
  rmds: number;
  /** The engine's own Total Income scalar. */
  totalIncome: number;
  /** Supplemental portfolio draws, split by the source account's tax treatment. */
  withdrawals: Record<WithdrawalSourceKey, number>;
  withdrawalsTotal: number;
  livingExpenses: number;
  totalExpenses: number;
  /** Total Income − Total Expenses. Negative years are funded by `withdrawals`. */
  netCashFlow: number;
}

function emptyWithdrawals(): Record<WithdrawalSourceKey, number> {
  return { cash: 0, taxable: 0, preTax: 0, roth: 0 };
}

/**
 * RMDs that reached household checking, which is the slice `totalIncome`
 * carries (`householdRmdIncome` in projection.ts phase 14).
 *
 * Deliberately NOT `rmdTotal` from `@/lib/retirement/retirement-inflows` — that
 * one sums `rmdAmount` across *every* ledger. The engine stamps `rmdAmount` on
 * an entity-owned retirement account too, then routes that cash to the entity's
 * own checking, so counting it here would make the RMDs column exceed the Total
 * Income it is supposed to be a part of and push the Other Income residual
 * negative. `controllingFamilyMember` is the same predicate the engine's own
 * routing branch uses.
 */
function householdRmdTotal(
  y: ProjectionYear,
  householdAccountIds: ReadonlySet<string>,
): number {
  let total = 0;
  for (const [accountId, ledger] of Object.entries(y.accountLedgers)) {
    if (householdAccountIds.has(accountId)) total += ledger.rmdAmount;
  }
  return total;
}

export function buildIncomeReportRows(
  years: readonly ProjectionYear[],
  accounts: readonly Account[],
): IncomeReportRow[] {
  const bucketOf = new Map<string, WithdrawalTaxBucket>();
  const householdAccountIds = new Set<string>();
  for (const a of accounts) {
    bucketOf.set(a.id, accountTaxBucket(a));
    if (controllingFamilyMember(a) != null) householdAccountIds.add(a.id);
  }

  return years.map((y) => {
    const withdrawals = emptyWithdrawals();
    for (const [accountId, amount] of Object.entries(y.withdrawals.byAccount)) {
      // Engine-minted accounts (equity destinations, overdraft sentinels) aren't
      // in the tree; they behave as taxable, matching `lifetimeFunding`.
      withdrawals[bucketOf.get(accountId) ?? "taxable"] += amount;
    }

    const socialSecurity = y.income.socialSecurity;
    const salaries = y.income.salaries;
    const rmds = householdRmdTotal(y, householdAccountIds);

    return {
      year: y.year,
      ages: y.ages,
      socialSecurity,
      salaries,
      otherIncome: y.totalIncome - socialSecurity - salaries - rmds,
      rmds,
      totalIncome: y.totalIncome,
      withdrawals,
      withdrawalsTotal: y.withdrawals.total,
      livingExpenses: y.expenses.living,
      totalExpenses: y.totalExpenses,
      netCashFlow: y.netCashFlow,
    };
  });
}

/**
 * The draw sources actually used somewhere in the projection, in canonical
 * order. Pass the *full* projection so a column doesn't appear and disappear as
 * a year-range filter moves (same rule as `filterAllZeroColumns`).
 */
export function activeWithdrawalSources(
  rows: readonly IncomeReportRow[],
): WithdrawalSource[] {
  return WITHDRAWAL_SOURCES.filter((s) =>
    rows.some((r) => r.withdrawals[s.key] !== 0),
  );
}
