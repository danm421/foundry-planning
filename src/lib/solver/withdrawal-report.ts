// Per-year decomposition behind the Solver's Cash Flow → Withdrawals report:
// what the portfolio had to cover each year, which tax treatment it came from,
// and how hard that leaned on the portfolio.
//
// Every income and expense figure is the engine's own scalar, passed through
// whole, so `totalIncome - totalExpenses === netCashFlow` holds on every row and
// the table can't drift from the chart above it.
import type { Account, ProjectionYear } from "@/engine/types";
import { controllingFamilyMember } from "@/engine/ownership";
import { liquidPortfolioBoy } from "@/engine/portfolio-snapshot";
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

export interface WithdrawalReportRow {
  year: number;
  ages: { client: number; spouse?: number };
  /** The engine's own Total Income scalar. */
  totalIncome: number;
  /** Supplemental portfolio draws, split by the source account's tax treatment. */
  withdrawals: Record<WithdrawalSourceKey, number>;
  withdrawalsTotal: number;
  /** Beginning-of-year liquid portfolio — the rate's denominator, shown beside it. */
  portfolioBoy: number;
  /** (`withdrawalsTotal` + household RMDs) ÷ `portfolioBoy`, as a fraction. RMDs
   *  ride in the numerator but have no column, so this deliberately exceeds
   *  `withdrawalsTotal / portfolioBoy` in an RMD year. 0 when there is no
   *  portfolio to draw against. */
  withdrawalRate: number;
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
 * own checking, so counting it would charge the household's withdrawal rate for
 * a draw it never received. `controllingFamilyMember` is the same predicate the
 * engine's own routing branch uses.
 *
 * The on-screen cash-flow report's "Withdrawal %" still sums every ledger
 * (cashflow-report.tsx ≈ line 1850), so for a client with an entity-owned
 * retirement account this column reads lower than that one. The presentation
 * drill already scopes its numerator the same way this does (F82).
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

export function buildWithdrawalReportRows(
  years: readonly ProjectionYear[],
  accounts: readonly Account[],
): WithdrawalReportRow[] {
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

    const rmds = householdRmdTotal(y, householdAccountIds);
    const portfolioBoy = liquidPortfolioBoy(y, years);
    // RMDs belong in the numerator even though the engine tracks them on
    // `ledger.rmdAmount` rather than inside `withdrawals.byAccount`: the column
    // answers "how much cash came out of the portfolio this year", and leaving
    // forced distributions out under-reports the strain on a retiree living on
    // them. Same convention as the cash-flow report's Withdrawal %.
    const numerator = y.withdrawals.total + rmds;

    return {
      year: y.year,
      ages: y.ages,
      totalIncome: y.totalIncome,
      withdrawals,
      withdrawalsTotal: y.withdrawals.total,
      portfolioBoy,
      withdrawalRate: portfolioBoy > 0 ? numerator / portfolioBoy : 0,
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
  rows: readonly WithdrawalReportRow[],
): WithdrawalSource[] {
  return WITHDRAWAL_SOURCES.filter((s) =>
    rows.some((r) => r.withdrawals[s.key] !== 0),
  );
}
