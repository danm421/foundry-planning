// Pure data transformation: ProjectionYear[] + ClientData → CashFlowPageData.
// Framework-free. Drives both the chart and the table.

import type {
  BuildCashFlowInput,
  CashFlowPageData,
  CashFlowTableRow,
  TableMarker,
} from "../../types";
import type { ClientData, ProjectionYear } from "@/engine/types";
import { buildCashFlowChartSpec } from "../../charts/cashflow-chart-spec";
import { filterYearsToRange } from "../../shared/year-filter";
import {
  liquidPortfolioActivity,
  liquidPortfolioGrowth,
  liquidPortfolioWeights,
} from "@/engine/portfolio-snapshot";

// Scope for the RMD column only — household + IIP-entity accounts. NOT the
// liquid-portfolio set: `accessibleTrustAssets` accounts are non-IIP entities
// whose RMD routes to entity checking rather than household income, so counting
// them here would push the RMD bar above totalIncome again (F81).
const RMD_BUCKETS = [
  "taxable", "cash", "retirement", "realEstate", "business", "lifeInsurance",
] as const;

const DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

export function buildCashFlowPageData(input: BuildCashFlowInput): CashFlowPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;

  const visibleYears = filterYearsToRange(years, options.range);

  const rows: CashFlowTableRow[] = visibleYears.map((py) => {
    const rmds = sumRmdAmounts(py, rmdAccountIds(py));
    // Computed once and shared: growth and activity must be measured over the
    // same accounts and ownership shares that compose `portfolioAssets` below,
    // or the row identity (assets = prior assets + growth + activity) breaks.
    const weights = liquidPortfolioWeights(py);
    const otherInflows =
      py.income.business +
      py.income.trust +
      py.income.deferred +
      py.income.other +
      py.income.capitalGains;
    return {
      year: py.year,
      ageClient: py.ages.client ?? null,
      ageSpouse: py.ages.spouse ?? null,
      cells: {
        salary: py.income.salaries,
        socialSecurity: py.income.socialSecurity,
        otherInflows,
        rmds,
        withdrawals: py.withdrawals.total,
        totalIncome: py.totalIncome,
        expenses: py.expenses.total,
        savings: py.savings.total,
        totalExpenses: py.totalExpenses,
        netCashFlow: py.netCashFlow,
        portfolioGrowth: liquidPortfolioGrowth(py, weights),
        portfolioActivity: liquidPortfolioActivity(py, weights),
        // H1: canonical liquid investable total (engine field) — ties to the
        // portfolio chart bar height and the next-year BoY carry-forward.
        portfolioAssets: py.portfolioAssets.liquidTotal,
      },
    };
  });

  const markers = buildMarkers(clientData, visibleYears, clientName, spouseName);
  const callout = computeCallout(options);
  const chartSpec = buildCashFlowChartSpec({ rows, markers });

  return {
    title: "Cash Flow",
    subtitle: scenarioLabel,
    callout,
    chartSpec,
    table: { rows, markers },
    footnote: DISCLAIMER,
  };
}

// Sum the engine's per-ledger `rmdAmount` — set once on the source retirement
// account. Mirrors the in-app Cash Flow chart (solver-cash-flow-chart.tsx).
// Do NOT scan `entries` for `category === "rmd"`: each RMD writes two such
// entries (a `-rmd` distribution on the retirement account and a `+rmd` credit
// on checking via `creditCash`), so `Math.abs`-summing them double-counts —
// inflating the table's RMDs column and pushing the chart's stacked bar above
// the Total Expenses line in RMD years.
//
// Scope to the household-portfolio account ids: the engine sets `rmdAmount` on
// EVERY rmd-enabled ledger (projection.ts:1404), but entity-owned (non-IIP
// trust) accounts route their RMD to entity checking, not to
// householdRmdIncome/totalIncome. Counting them here would push the RMD bar
// above totalIncome so the stacked total stops reconciling (F81).
function sumRmdAmounts(py: ProjectionYear, ids: Set<string>): number {
  let total = 0;
  for (const id of ids) total += py.accountLedgers?.[id]?.rmdAmount ?? 0;
  return total;
}

// Account ids in a household / IIP-entity portfolio bucket — see RMD_BUCKETS.
function rmdAccountIds(py: ProjectionYear): Set<string> {
  const ids = new Set<string>();
  for (const bucket of RMD_BUCKETS) {
    const byAcct = py.portfolioAssets[bucket] as Record<string, number> | undefined;
    if (!byAcct) continue;
    for (const id of Object.keys(byAcct)) ids.add(id);
  }
  return ids;
}

function buildMarkers(
  clientData: ClientData,
  visibleYears: ProjectionYear[],
  clientName: string,
  spouseName: string | null,
): TableMarker[] {
  const minYear = visibleYears[0]?.year ?? -Infinity;
  const maxYear = visibleYears[visibleYears.length - 1]?.year ?? Infinity;
  const ci = clientData.client;

  type Principal = {
    who: "client" | "spouse";
    name: string;
    yob: number | null;
    retirementAge: number | null;
    lifeExpectancyOrPlanEnd: number | null;
  };

  const principals: Principal[] = [];
  if (ci.dateOfBirth) {
    principals.push({
      who: "client",
      name: clientName,
      yob: new Date(ci.dateOfBirth).getUTCFullYear(),
      retirementAge: ci.retirementAge ?? null,
      lifeExpectancyOrPlanEnd: ci.lifeExpectancy ?? ci.planEndAge ?? null,
    });
  }
  if (ci.spouseDob) {
    principals.push({
      who: "spouse",
      name: spouseName ?? ci.spouseName ?? "Spouse",
      yob: new Date(ci.spouseDob).getUTCFullYear(),
      retirementAge: ci.spouseRetirementAge ?? null,
      lifeExpectancyOrPlanEnd: ci.spouseLifeExpectancy ?? ci.planEndAge ?? null,
    });
  }

  const markers: TableMarker[] = [];
  for (const p of principals) {
    if (p.yob == null) continue;
    if (p.retirementAge != null) {
      const y = p.yob + p.retirementAge;
      if (y >= minYear && y <= maxYear) {
        markers.push({ year: y, kind: "retirement", who: p.who, label: `${p.name} — Retirement` });
      }
    }
    if (p.lifeExpectancyOrPlanEnd != null) {
      const y = p.yob + p.lifeExpectancyOrPlanEnd;
      if (y >= minYear && y <= maxYear) {
        markers.push({ year: y, kind: "endOfLife", who: p.who, label: `${p.name} — End of Life` });
      }
    }
  }
  return collapseJointMarkers(markers, clientName, spouseName ?? ci.spouseName ?? "Spouse");
}

function collapseJointMarkers(
  markers: TableMarker[],
  clientName: string,
  spouseName: string,
): TableMarker[] {
  const grouped = new Map<string, TableMarker[]>();
  for (const m of markers) {
    const k = `${m.year}|${m.kind}`;
    const list = grouped.get(k) ?? [];
    list.push(m);
    grouped.set(k, list);
  }
  const result: TableMarker[] = [];
  for (const list of grouped.values()) {
    if (list.length >= 2) {
      const joint = list[0];
      result.push({
        ...joint,
        who: "joint",
        label: `${clientName} & ${spouseName} — ${joint.kind === "retirement" ? "Retirement" : "End of Life"}`,
      });
    } else {
      result.push(...list);
    }
  }
  return result.sort((a, b) => a.year - b.year);
}

function computeCallout(options: BuildCashFlowInput["options"]): string | undefined {
  if (!options.showCallout) return undefined;
  return options.calloutText ?? undefined;
}
