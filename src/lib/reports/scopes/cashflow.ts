// src/lib/reports/scopes/cashflow.ts
//
// Cashflow scope: extracts year-by-year income / expenses / savings / net
// from the projection and exposes both a structured shape (for chart and
// table widgets in Task 21) and a token-capped string (for the AI-analysis
// widget). The structured shape is intentionally flat and human-readable —
// downstream widgets don't need to know how the engine partitions income.

import { registerScope } from "@/lib/reports/scope-registry";
import type { ProjectionYear } from "@/engine/types";

export type CashflowScopeData = {
  years: {
    year: number;
    incomeWages: number;
    incomeSocialSecurity: number;
    incomePensions: number;
    incomeWithdrawals: number;
    incomeOther: number;
    expenses: number;
    savings: number;
    net: number;
  }[];
};

/** Sum of all income components for a single cashflow row. Withdrawals
 *  are intentionally included — they fund retirement spending and the
 *  bar chart treats them as part of total income. */
export function totalIncome(y: CashflowScopeData["years"][number]): number {
  return (
    y.incomeWages +
    y.incomeSocialSecurity +
    y.incomePensions +
    y.incomeWithdrawals +
    y.incomeOther
  );
}

function project(p: ProjectionYear): CashflowScopeData["years"][number] {
  return {
    year: p.year,
    incomeWages: p.income.salaries,
    incomeSocialSecurity: p.income.socialSecurity,
    // The engine does not (yet) break out pensions as a distinct income
    // stream — `Income.type` lacks a "pension" category. Surface 0 here so
    // the scope shape is stable for chart widgets; if advisors need pensions
    // separately, see `future-work/engine.md` (Foundry Reports v1 follow-ups).
    incomePensions: 0,
    // `withdrawals.total` only — `entityWithdrawals` is intentionally
    // separate (entity-internal liquidations don't count as household income).
    incomeWithdrawals: p.withdrawals.total,
    // Residual income: every engine income type that isn't already broken
    // out above. Combined here so the bar-chart widget has a single "Other"
    // bucket without dropping any dollars.
    incomeOther:
      p.income.business +
      p.income.trust +
      p.income.deferred +
      p.income.capitalGains +
      p.income.other,
    expenses: p.expenses.total,
    savings: p.savings.total,
    net: p.netCashFlow,
  };
}

registerScope({
  key: "cashflow",
  label: "Cashflow",
  fetch: ({ projection }) => ({ years: projection.map(project) }),
  serializeForAI: (data) => {
    const d = data as CashflowScopeData;
    if (!d.years.length) return "Cashflow: no data.";
    const first = d.years[0];
    const last = d.years[d.years.length - 1];
    const peak = d.years.reduce(
      (a, b) => (b.expenses > a.expenses ? b : a),
      first,
    );
    return [
      `Cashflow ${first.year}–${last.year}.`,
      `Year ${first.year}: income $${totalIncome(first).toFixed(0)}, expenses $${first.expenses.toFixed(0)}, savings $${first.savings.toFixed(0)}.`,
      `Year ${last.year}: income $${totalIncome(last).toFixed(0)}, expenses $${last.expenses.toFixed(0)}.`,
      `Peak expense year: ${peak.year} at $${peak.expenses.toFixed(0)}.`,
    ].join(" ");
  },
});
