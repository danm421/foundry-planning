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

const DISCLAIMER =
  "This analysis is based on assumptions provided by you. Projections are hypothetical and not guaranteed. Actual results will vary.";

export function buildCashFlowPageData(input: BuildCashFlowInput): CashFlowPageData {
  const { years, clientData, options, scenarioLabel, clientName, spouseName } = input;

  const visibleYears = filterYearsToRange(years, clientData, options.range);

  const rows: CashFlowTableRow[] = visibleYears.map((py) => {
    const rmds = sumRmdAmounts(py);
    const otherIncome =
      py.income.business +
      py.income.trust +
      py.income.deferred +
      py.income.other +
      py.income.capitalGains;
    const discretionary = py.withdrawals.total - rmds;
    return {
      year: py.year,
      ageClient: py.ages.client ?? null,
      ageSpouse: py.ages.spouse ?? null,
      cells: {
        totalExpenses: py.totalExpenses,
        salary: py.income.salaries,
        socialSecurity: py.income.socialSecurity,
        otherIncome,
        rmds,
        withdrawals: discretionary,
        totalWithdrawalsSpent: py.withdrawals.total,
        netSavings: py.savings.total,
        totalPortfolioAssets:
          py.portfolioAssets.taxableTotal +
          py.portfolioAssets.cashTotal +
          py.portfolioAssets.retirementTotal,
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

function sumRmdAmounts(py: ProjectionYear): number {
  let total = 0;
  for (const ledger of Object.values(py.accountLedgers ?? {})) {
    for (const entry of ledger.entries ?? []) {
      if (entry.category === "rmd") total += Math.abs(entry.amount);
    }
  }
  return total;
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
