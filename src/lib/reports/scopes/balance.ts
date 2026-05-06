// src/lib/reports/scopes/balance.ts
//
// Balance scope: extracts a per-year net-worth trajectory from the projection
// for the netWorthLine widget (Task 25). The shape is intentionally flat —
// downstream widgets don't need to know how the engine partitions assets or
// liabilities.
//
// Mapping decisions (worth knowing before reading the numbers):
//
// 1. `netWorth = portfolioAssets.total - Σ liabilityBalancesBoY`. The engine
//    only exposes BoY (beginning-of-year) liability balances — there is no
//    `liabilityBalancesEoY`. We mix EoY assets with BoY liabilities, which
//    introduces ~one year of liability paydown drift. Over a 25-year horizon
//    on a typical mortgage that drift is small; advisors care more about
//    correctness in taxable-event years (death triggering payoffs). See
//    future-work/engine.md → Foundry Reports v1 follow-ups for the fix.
//
// 2. `liquidNetWorth = cashTotal + taxableTotal`. Liquid assets only — we
//    don't subtract liabilities here. Advisors read "liquid" as "what you
//    can access without selling/penalty"; netting liabilities against that
//    figure would be misleading (a HELOC isn't liquid the same way cash is).
//    Retirement, real-estate, business, and life-insurance values stay out.
import { registerScope } from "@/lib/reports/scope-registry";
import type { ProjectionYear } from "@/engine/types";

export type BalanceScopeData = {
  years: { year: number; netWorth: number; liquidNetWorth: number }[];
};

function project(p: ProjectionYear): BalanceScopeData["years"][number] {
  const liabilitiesTotal = Object.values(p.liabilityBalancesBoY).reduce(
    (a, b) => a + b,
    0,
  );
  return {
    year: p.year,
    netWorth: p.portfolioAssets.total - liabilitiesTotal,
    liquidNetWorth:
      p.portfolioAssets.cashTotal + p.portfolioAssets.taxableTotal,
  };
}

registerScope({
  key: "balance",
  label: "Balance",
  fetch: ({ projection }): BalanceScopeData => ({
    years: projection.map(project),
  }),
  serializeForAI: (data) => {
    const d = data as BalanceScopeData;
    if (!d.years.length) return "Balance: no data.";
    const first = d.years[0];
    const last = d.years[d.years.length - 1];
    return [
      `Balance ${first.year}–${last.year}.`,
      `Net worth ${first.year} $${first.netWorth.toFixed(0)} → ${last.year} $${last.netWorth.toFixed(0)}.`,
      `Liquid net worth ${first.year} $${first.liquidNetWorth.toFixed(0)} → ${last.year} $${last.liquidNetWorth.toFixed(0)}.`,
    ].join(" ");
  },
});
