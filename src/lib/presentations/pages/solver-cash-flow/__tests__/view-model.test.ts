import { describe, it, expect } from "vitest";
import { dataLight } from "@/brand";
import { yearWithdrawalRate } from "@/lib/solver/withdrawal-report";
import {
  resolveSolverCashFlowYear,
  solverCashFlowSheets,
  type BreakdownRow,
  type SolverCashFlowPageData,
} from "../view-model";
import { solverCashFlowOptionsSchema } from "../options-schema";
import { build, clientData, withLiabilities, YEARS } from "./fixtures";

/** The Liabilities line items each sheet prints, in order. */
function liabilityItems(data: SolverCashFlowPageData): string[][] {
  return solverCashFlowSheets(data).map((sheet) =>
    sheet.outflows.flatMap((r) =>
      r.kind === "category" && r.category.key === "liabilities" ? r.category.items.map((i) => i.label) : [],
    ),
  );
}

const labelOf = (r: BreakdownRow) => (r.kind === "total" ? r.label : r.category.label);

describe("resolveSolverCashFlowYear", () => {
  it("opens on the first plan year, like the Solver, and clamps a stale year into the plan", () => {
    expect(resolveSolverCashFlowYear(YEARS, null)).toBe(2026);
    expect(resolveSolverCashFlowYear(YEARS, 2027)).toBe(2027);
    expect(resolveSolverCashFlowYear(YEARS, 2019)).toBe(2026);
    expect(resolveSolverCashFlowYear(YEARS, 2099)).toBe(2027);
    expect(resolveSolverCashFlowYear([], 2030)).toBeNull();
  });
});

describe("solverCashFlowOptionsSchema", () => {
  it("reads a deck saved with the page's earlier range options as the first plan year", () => {
    expect(solverCashFlowOptionsSchema.parse({ range: "full", showCallout: false })).toEqual({ year: null });
  });
});

describe("buildSolverCashFlowData", () => {
  it("prints the year panel's breakdown: inflows before withdrawals, withdrawals on their own", () => {
    const data = build();
    expect(data.title).toBe("One-Year Cash Flow");
    expect(data.subtitle).toBe("Base Case");
    expect(data.year).toBe(2026);
    expect(data.ageLabel).toBe("Age 59 / 62");
    expect(data.inflows.map((c) => [c.label, c.total])).toEqual([
      ["Social Security", 22_742],
      ["Other Inflows", 66_300],
    ]);
    expect(data.withdrawals!.label).toBe("Portfolio Withdrawals");
    expect(data.withdrawals!.items.map((i) => [i.label, i.amount])).toEqual([
      ["Schwab HY", 9_952],
      ["Cash", 17_306],
    ]);
    expect(data.outflows.map((c) => [c.label, c.total])).toEqual([
      ["Living Expenses", 64_000],
      ["Liabilities", 10_466],
      ["Taxes", 34_800],
    ]);
    expect(data.totals).toEqual({
      inflows: 89_042,
      outflows: 109_266,
      net: -20_224,
      endingPortfolio: 1_627_541,
    });
  });

  it("colors each inflow like its bar and leaves outflows neutral", () => {
    const data = build();
    expect(data.inflows.map((c) => c.color)).toEqual([dataLight.blue, dataLight.teal]);
    expect(data.withdrawals!.color).toBe(dataLight.yellow);
    expect(data.outflows.every((c) => c.color === null)).toBe(true);
  });

  it("prints the screen's Withdrawal %, and none in a year nothing is drawn", () => {
    expect(build(2026).withdrawalRate).toBe(yearWithdrawalRate(YEARS[0], YEARS, clientData().accounts));
    expect(build(2027).withdrawalRate).toBe(0);
    expect(build(2027).withdrawals).toBeNull();
  });

  it("outlines the chosen year on the chart", () => {
    const { chartSpec } = build(2027);
    expect(chartSpec!.highlightX).toBe(2027);
    expect(chartSpec!.xAxis.domain).toEqual([2026, 2027]);
    expect(chartSpec!.stacks.map((s) => s.label)).toEqual(["Social Security", "Other Inflows", "Withdrawals"]);
    expect(chartSpec!.lines.map((l) => l.label)).toEqual(["Total Out"]);
  });

  it("keeps the chart on top however long the breakdown runs", () => {
    for (const count of [1, 25, 80]) {
      expect(withLiabilities(count).chartSpec).not.toBeNull();
    }
  });

  it("prints a breakdown that fits under the chart on one sheet, in column order", () => {
    const sheets = solverCashFlowSheets(build(2026));
    expect(sheets).toHaveLength(1);
    expect(sheets[0].inflows.map(labelOf)).toEqual([
      "Social Security",
      "Other Inflows",
      "Total Inflows",
      "Portfolio Withdrawals",
    ]);
    expect(sheets[0].outflows.map(labelOf)).toEqual([
      "Living Expenses",
      "Liabilities",
      "Taxes",
      "Total Outflows",
    ]);
  });

  it("carries a breakdown too long for one sheet onto the next, every line item kept", () => {
    const data = withLiabilities(25);
    const sheets = solverCashFlowSheets(data);
    expect(sheets).toHaveLength(2);
    const [first, second] = liabilityItems(data);
    expect([...first, ...second]).toEqual(Array.from({ length: 25 }, (_, i) => `Mortgage ${i}`));
    // The category splits between its line items; the rest picks up under a
    // "continued" heading, and the column's total closes the last sheet.
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
    expect(sheets[1].outflows[0]).toMatchObject({ kind: "category", continued: true });
    expect(sheets[1].outflows.at(-1)).toEqual({ kind: "total", label: "Total Outflows", total: 89_000 });
    // The short column printed in full on the first sheet.
    expect(sheets[1].inflows).toEqual([]);
  });

  it("runs onto as many sheets as the breakdown needs", () => {
    const data = withLiabilities(80);
    expect(solverCashFlowSheets(data)).toHaveLength(3);
    expect(liabilityItems(data).flat()).toEqual(Array.from({ length: 80 }, (_, i) => `Mortgage ${i}`));
  });

  it("says so when the projection has no years", () => {
    const data = build(null, clientData(), []);
    expect(data.year).toBeNull();
    expect(data.chartSpec).toBeNull();
    expect(solverCashFlowSheets(data)).toEqual([]);
  });
});
