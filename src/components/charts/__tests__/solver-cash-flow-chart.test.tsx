import { describe, it, expect } from "vitest";
import type { ProjectionYear } from "@/engine";
import { buildSolverCashFlowChartData } from "../solver-cash-flow-chart";

function year(over: Record<string, unknown>): ProjectionYear {
  return {
    year: 2026,
    income: {
      socialSecurity: 0,
      salaries: 0,
      business: 0,
      deferred: 0,
      capitalGains: 0,
      trust: 0,
      other: 0,
    },
    withdrawals: { total: 0 },
    totalExpenses: 0,
    accountLedgers: {},
    ...over,
  } as unknown as ProjectionYear;
}

describe("buildSolverCashFlowChartData", () => {
  it("emits five stacked income bars plus a Total Expenses line", () => {
    const data = buildSolverCashFlowChartData([year({ year: 2026 })]);
    expect(data.labels).toEqual(["2026"]);

    const bars = data.datasets.filter((d) => d.type === "bar");
    const lines = data.datasets.filter((d) => d.type === "line");
    expect(bars.map((d) => d.label)).toEqual([
      "Social Security",
      "Salaries",
      "Other Inflows",
      "RMDs",
      "Withdrawals",
    ]);
    expect(bars.every((d) => d.stack === "inflows")).toBe(true);
    expect(lines.map((d) => d.label)).toEqual(["Total Expenses"]);
  });

  it("sums Other Inflows from business/deferred/capitalGains/trust/other", () => {
    const data = buildSolverCashFlowChartData([
      year({
        income: {
          socialSecurity: 0,
          salaries: 0,
          business: 1,
          deferred: 2,
          capitalGains: 3,
          trust: 4,
          other: 5,
        },
      }),
    ]);
    const other = data.datasets.find((d) => d.label === "Other Inflows");
    expect(other?.data).toEqual([15]);
  });

  it("sums RMDs across account ledgers", () => {
    const data = buildSolverCashFlowChartData([
      year({ accountLedgers: { a: { rmdAmount: 100 }, b: { rmdAmount: 50 } } }),
    ]);
    const rmds = data.datasets.find((d) => d.label === "RMDs");
    expect(rmds?.data).toEqual([150]);
  });
});
