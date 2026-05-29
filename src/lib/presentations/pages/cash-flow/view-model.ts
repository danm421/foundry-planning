// Pure data transformation: ProjectionYear[] + ClientData → CashFlowPageData.
// Framework-free. Drives both the chart and the table.

import type {
  BuildCashFlowInput,
  CashFlowPageData,
  CashFlowTableRow,
  TableMarker,
} from "../../types";
import type { ClientData, ClientInfo, ProjectionYear } from "@/engine/types";
import { buildCashFlowChartSpec } from "../../charts/cashflow-chart-spec";

const PORTFOLIO_BUCKETS = [
  "taxable", "cash", "retirement", "realEstate", "business", "lifeInsurance",
] as const;

const DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

export function buildCashFlowPageData(input: BuildCashFlowInput): CashFlowPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;

  const visibleYears = filterYearsToRange(years, clientData, options.range);

  const rows: CashFlowTableRow[] = visibleYears.map((py) => {
    const rmds = sumRmdAmounts(py);
    const otherInflows =
      py.income.business +
      py.income.trust +
      py.income.deferred +
      py.income.other +
      py.income.capitalGains;
    const ids = portfolioAccountIds(py);
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
        portfolioGrowth: portfolioGrowthTotal(py, ids),
        portfolioActivity: portfolioActivityTotal(py, ids),
        portfolioAssets:
          py.portfolioAssets.taxableTotal +
          py.portfolioAssets.cashTotal +
          py.portfolioAssets.retirementTotal +
          py.portfolioAssets.lifeInsuranceTotal,
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

function filterYearsToRange(
  years: ProjectionYear[],
  clientData: ClientData,
  range: BuildCashFlowInput["options"]["range"],
): ProjectionYear[] {
  if (range === "lifetime") return years;
  if (typeof range === "object") {
    return years.filter((y) => y.year >= range.startYear && y.year <= range.endYear);
  }
  // "retirement" — filter to first-retirement-year onward
  const firstRetirementYear = computeFirstRetirementYear(clientData.client);
  if (firstRetirementYear == null) return years;
  return years.filter((y) => y.year >= firstRetirementYear);
}

function computeFirstRetirementYear(client: ClientInfo): number | null {
  const candidates: number[] = [];
  if (client.dateOfBirth && client.retirementAge != null) {
    candidates.push(new Date(client.dateOfBirth).getUTCFullYear() + client.retirementAge);
  }
  if (client.spouseDob && client.spouseRetirementAge != null) {
    candidates.push(new Date(client.spouseDob).getUTCFullYear() + client.spouseRetirementAge);
  }
  return candidates.length ? Math.min(...candidates) : null;
}

// Sum the engine's per-ledger `rmdAmount` — set once on the source retirement
// account. Mirrors the in-app Cash Flow chart (solver-cash-flow-chart.tsx).
// Do NOT scan `entries` for `category === "rmd"`: each RMD writes two such
// entries (a `-rmd` distribution on the retirement account and a `+rmd` credit
// on checking via `creditCash`), so `Math.abs`-summing them double-counts —
// inflating the table's RMDs column and pushing the chart's stacked bar above
// the Total Expenses line in RMD years.
function sumRmdAmounts(py: ProjectionYear): number {
  let total = 0;
  for (const ledger of Object.values(py.accountLedgers ?? {})) {
    total += ledger.rmdAmount ?? 0;
  }
  return total;
}

// Account ids appearing in any portfolio bucket — used to scope growth /
// activity sums to the same accounts the in-app Cash Flow report counts.
function portfolioAccountIds(py: ProjectionYear): Set<string> {
  const ids = new Set<string>();
  for (const bucket of PORTFOLIO_BUCKETS) {
    const byAcct = py.portfolioAssets[bucket] as Record<string, number> | undefined;
    if (!byAcct) continue;
    for (const id of Object.keys(byAcct)) ids.add(id);
  }
  return ids;
}

function portfolioGrowthTotal(py: ProjectionYear, ids: Set<string>): number {
  let sum = 0;
  for (const id of ids) sum += py.accountLedgers?.[id]?.growth ?? 0;
  return sum;
}

// External (non-internal-transfer) additions minus distributions — same
// netting the in-app drill-down uses so supplemental refill legs don't
// inflate the activity column.
function portfolioActivityTotal(py: ProjectionYear, ids: Set<string>): number {
  let additions = 0;
  let distributions = 0;
  for (const id of ids) {
    const led = py.accountLedgers?.[id];
    if (!led) continue;
    additions += led.contributions - (led.internalContributions ?? 0);
    distributions += led.distributions - (led.internalDistributions ?? 0);
  }
  return additions - distributions;
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
  if (options.calloutText != null) return options.calloutText;
  if (options.range === "retirement") return "Cash flow begins at Retirement.";
  return undefined;
}
