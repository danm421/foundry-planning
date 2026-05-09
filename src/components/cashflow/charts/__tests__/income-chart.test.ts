import { describe, it, expect } from "vitest";
import { buildIncomeDatasets } from "../income-chart";
import { incomeFixture } from "./fixtures";

describe("buildIncomeDatasets", () => {
  it("returns one series per income category", () => {
    const series = buildIncomeDatasets();
    const labels = series.map((s) => s.label);
    expect(labels).toEqual([
      "Salaries",
      "Social Security",
      "Business",
      "Trust",
      "Deferred",
      "Capital Gains",
      "Other",
    ]);
  });

  it("each series's valueFor reads the matching income field", () => {
    const series = buildIncomeDatasets();
    const salaries = series.find((s) => s.label === "Salaries")!;
    expect(salaries.valueFor(incomeFixture[0])).toBe(100_000);
    const ss = series.find((s) => s.label === "Social Security")!;
    expect(ss.valueFor(incomeFixture[0])).toBe(0);
    expect(ss.valueFor(incomeFixture[1])).toBe(30_000);
  });

  it("zero in years where the source is absent", () => {
    const series = buildIncomeDatasets();
    const cg = series.find((s) => s.label === "Capital Gains")!;
    expect(cg.valueFor(incomeFixture[0])).toBe(0);
    expect(cg.valueFor(incomeFixture[2])).toBe(8_000);
  });
});
