import { describe, it, expect } from "vitest";
import { buildExpensesDatasets } from "../expenses-chart";
import { makeYear } from "./fixtures";

describe("buildExpensesDatasets", () => {
  it("returns one series per expense category", () => {
    const labels = buildExpensesDatasets().map((s) => s.label);
    expect(labels).toEqual(["Living", "Real Estate", "Insurance", "Taxes", "Debt service", "Other"]);
  });

  it("each series reads the matching expenses field", () => {
    const series = buildExpensesDatasets();
    const y = makeYear({
      year: 2026,
      expenses: {
        living: 60_000,
        realEstate: 12_000,
        insurance: 3_000,
        taxes: 25_000,
        liabilities: 10_000,
        other: 5_000,
        cashGifts: 0,
        total: 115_000,
        bySource: {},
        byLiability: {},
        interestByLiability: {},
      },
    });
    expect(series.find((s) => s.label === "Living")!.valueFor(y)).toBe(60_000);
    expect(series.find((s) => s.label === "Real Estate")!.valueFor(y)).toBe(12_000);
    expect(series.find((s) => s.label === "Debt service")!.valueFor(y)).toBe(10_000);
    expect(series.find((s) => s.label === "Other")!.valueFor(y)).toBe(5_000);
  });
});
