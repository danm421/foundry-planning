/**
 * Side-effect module: registering all v1 metrics on the shared registry.
 *
 * Import this file once at app boot (or once per test that needs the registry
 * populated). The registrations use the verified `ProjectionYear` shape from
 * `src/engine/types.ts` — see Task 10 of the Foundry Reports v1 plan for the
 * full mapping table.
 */
import type { ProjectionYear } from "@/engine/types";
import { registerMetric } from "@/lib/reports/metric-registry";

function liabilityBalances(year: ProjectionYear): number {
  return Object.values(year.liabilityBalancesBoY).reduce((a, b) => a + b, 0);
}

function netWorthAt(year: ProjectionYear): number {
  return year.portfolioAssets.total - liabilityBalances(year);
}

function liquidNetWorthAt(year: ProjectionYear): number {
  return (
    year.portfolioAssets.taxableTotal +
    year.portfolioAssets.cashTotal -
    liabilityBalances(year)
  );
}

registerMetric({
  key: "netWorthNow",
  label: "Net worth (today)",
  category: "Net worth",
  format: "currency",
  fetch: ({ projection }) => (projection[0] ? netWorthAt(projection[0]) : null),
});

registerMetric({
  key: "liquidNetWorth",
  label: "Liquid net worth",
  category: "Net worth",
  format: "currency",
  fetch: ({ projection }) => (projection[0] ? liquidNetWorthAt(projection[0]) : null),
});

registerMetric({
  key: "netWorthAtRetirement",
  label: "Net worth at retirement",
  category: "Net worth",
  format: "currency",
  fetch: ({ projection, year }) => {
    const found = projection.find((y) => y.year === year);
    return found ? netWorthAt(found) : null;
  },
});

registerMetric({
  key: "monteCarloSuccessProbability",
  label: "Plan success probability",
  category: "Outlook",
  format: "percent",
  // Wired in Task 28 when the Monte Carlo scope ships.
  fetch: () => null,
});

registerMetric({
  key: "yearsToDepletion",
  label: "Years to depletion",
  category: "Outlook",
  format: "years",
  fetch: ({ projection }) => {
    if (projection.length === 0) return null;
    const start = projection[0].year;
    const fail = projection.find((y) => netWorthAt(y) < 0);
    return fail ? fail.year - start : null;
  },
});

registerMetric({
  key: "currentMarginalTaxRate",
  label: "Marginal tax rate (current)",
  category: "Tax",
  format: "percent",
  fetch: ({ projection }) =>
    projection[0]?.taxResult?.diag.marginalFederalRate ?? null,
});

registerMetric({
  key: "effectiveTaxRate",
  label: "Effective tax rate (current)",
  category: "Tax",
  format: "percent",
  fetch: ({ projection }) =>
    projection[0]?.taxResult?.diag.effectiveFederalRate ?? null,
});

registerMetric({
  key: "annualSavings",
  label: "Annual savings",
  category: "Cashflow",
  format: "currency",
  fetch: ({ projection }) => projection[0]?.savings.total ?? null,
});

registerMetric({
  key: "annualSpending",
  label: "Annual spending",
  category: "Cashflow",
  format: "currency",
  fetch: ({ projection }) => projection[0]?.expenses.total ?? null,
});

registerMetric({
  key: "taxableEstateValue",
  label: "Taxable estate value",
  category: "Estate",
  format: "currency",
  // `hypotheticalEstateTax` is on every projection year, but the right field
  // path (which death side, which year) is owned by Task 27/28 estate-scope
  // work. Return null until that lands.
  fetch: () => null,
});
