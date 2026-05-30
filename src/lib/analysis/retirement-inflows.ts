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
  /** business + deferred + capital gains + trust + other income. */
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
    y.income.other
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
