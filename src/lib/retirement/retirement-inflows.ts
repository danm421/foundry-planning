// Pure, framework-free decomposition of a retirement year's cash inflows toward
// expenses. Mirrors the Cash Flow report's inflow stack (Social Security,
// Salaries, Other Inflows, RMDs, Withdrawals) so the Retirement Analysis hero
// chart and the year table compute identical bands + shortfall.
//
// RMD cash is NOT part of income.total — the engine credits it straight to
// checking (see projection.ts creditCash) — so it's surfaced here as its own
// band and counted toward expense coverage, matching the Cash Flow chart.
import type { ProjectionYear } from "@/engine/types";

export interface RetirementInflows {
  socialSecurity: number;
  salaries: number;
  /** business + deferred + capital gains + trust + other income, plus household
   *  notes-receivable cash (principal + interest credited straight to checking). */
  otherInflows: number;
  /** Required minimum distributions across all account ledgers. */
  rmds: number;
  /** Supplemental portfolio withdrawals. */
  withdrawals: number;
  /** SS + salaries + other + RMDs + withdrawals — total cash toward expenses. */
  total: number;
  /** Unmet expense after all inflows. Always >= 0. */
  shortfall: number;
}

export function rmdTotal(y: ProjectionYear): number {
  return Object.values(y.accountLedgers).reduce((s, l) => s + l.rmdAmount, 0);
}

export function otherInflows(y: ProjectionYear): number {
  return (
    y.income.business +
    y.income.deferred +
    y.income.capitalGains +
    y.income.trust +
    y.income.other +
    // Notes-receivable cash is credited directly to checking (not income.*), so
    // it would otherwise be invisible to the funding/inflow stack and surface as
    // a phantom shortfall. Household-owner share only.
    (y.notesReceivableTotals?.householdCashIn ?? 0)
  );
}

export function retirementInflows(y: ProjectionYear): RetirementInflows {
  const socialSecurity = y.income.socialSecurity;
  const salaries = y.income.salaries;
  const other = otherInflows(y);
  const rmds = rmdTotal(y);
  const withdrawals = y.withdrawals.total;
  const total = socialSecurity + salaries + other + rmds + withdrawals;
  const shortfall = Math.max(0, y.totalExpenses - total);
  return { socialSecurity, salaries, otherInflows: other, rmds, withdrawals, total, shortfall };
}

/**
 * Is this year's shortfall real money, or is it float residue?
 *
 * `shortfall` is `Math.max(0, totalExpenses - total)` over two independently
 * accumulated sums, so a year the plan funds exactly lands a few picodollars
 * above zero rather than on it. On live plans the residue spans 1e-11 to about
 * half a dollar — every one of which prints as "$0".
 *
 * Any guard that decides whether to SAY something about a shortfall has to ask
 * this, never `shortfall > 0`; see `printsAsZero` in the Retirement Summary,
 * which is the same rule bound to that page's own formatter. This one cannot be
 * bound to a formatter, because its callers narrate a YEAR and print no dollar
 * figure at all — so it is pinned instead to the whole-dollar boundary that
 * every currency formatter in the app shares, and `retirement-inflows.test.ts`
 * holds all three of them to it.
 */
export function isMaterialShortfall(shortfall: number): boolean {
  return Math.round(shortfall) > 0;
}
