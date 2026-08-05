import { describe, it, expect } from "vitest";
import { withdrawalRow as row } from "@/lib/solver/__tests__/withdrawal-report-fixtures";
import { buildSolverWithdrawalChartData } from "../solver-withdrawal-chart";

describe("buildSolverWithdrawalChartData", () => {
  it("stacks one bar per drawn source, plus a Living Expenses line", () => {
    const data = buildSolverWithdrawalChartData([
      row({
        year: 2026,
        withdrawals: { cash: 1_000, taxable: 0, preTax: 9_000, roth: 0 },
        livingExpenses: 80_000,
      }),
    ]);

    expect(data.labels).toEqual(["2026"]);

    const bars = data.datasets.filter((d) => d.type === "bar");
    expect(bars.map((d) => d.label)).toEqual(["Cash", "Tax-Deferred"]);
    expect(bars.every((d) => d.stack === "withdrawals")).toBe(true);
    expect(bars.map((d) => d.data)).toEqual([[1_000], [9_000]]);

    const lines = data.datasets.filter((d) => d.type === "line");
    expect(lines.map((d) => d.label)).toEqual(["Living Expenses"]);
    expect(lines[0].data).toEqual([80_000]);
  });

  it("omits a source that is never drawn on across the whole projection", () => {
    const data = buildSolverWithdrawalChartData([
      row({ year: 2026, withdrawals: { cash: 0, taxable: 5_000, preTax: 0, roth: 0 } }),
      row({ year: 2027, withdrawals: { cash: 0, taxable: 0, preTax: 0, roth: 4_000 } }),
    ]);

    const bars = data.datasets.filter((d) => d.type === "bar");
    expect(bars.map((d) => d.label)).toEqual(["Taxable", "Roth"]);
    expect(bars.map((d) => d.data)).toEqual([
      [5_000, 0],
      [0, 4_000],
    ]);
  });

  it("gives each source a distinct color and re-resolves them per theme", () => {
    const rows = [
      row({ withdrawals: { cash: 1, taxable: 1, preTax: 1, roth: 1 } }),
    ];
    const dark = buildSolverWithdrawalChartData(rows, "dark").datasets.filter((d) => d.type === "bar");
    const light = buildSolverWithdrawalChartData(rows, "light").datasets.filter((d) => d.type === "bar");

    const darkColors = dark.map((d) => d.backgroundColor);
    expect(new Set(darkColors).size).toBe(4);
    expect(light.map((d) => d.backgroundColor)).not.toEqual(darkColors);
  });

  it("renders a bare line when nothing is withdrawn in any year", () => {
    const data = buildSolverWithdrawalChartData([row({ livingExpenses: 50_000 })]);
    expect(data.datasets.filter((d) => d.type === "bar")).toEqual([]);
    expect(data.datasets).toHaveLength(1);
  });
});
