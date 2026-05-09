import { describe, it, expect } from "vitest";
import { buildWithdrawalsDatasets } from "../withdrawals-chart";
import { makeYear } from "./fixtures";

describe("buildWithdrawalsDatasets", () => {
  it("groups withdrawals by asset category", () => {
    const accountCategoryById = {
      a1: "retirement",
      a2: "retirement",
      a3: "taxable",
      a4: "cash",
    };
    const years = [
      makeYear({
        year: 2026,
        withdrawals: { byAccount: { a1: 10_000, a2: 5_000, a3: 8_000, a4: 0 }, total: 23_000 },
      }),
      makeYear({
        year: 2027,
        withdrawals: { byAccount: { a1: 12_000, a3: 0, a4: 4_000 }, total: 16_000 },
      }),
    ];
    const series = buildWithdrawalsDatasets(years, accountCategoryById);
    const labels = series.map((s) => s.label).sort();
    expect(labels).toEqual(["Cash", "Retirement", "Taxable"]);
    const ret = series.find((s) => s.label === "Retirement")!;
    expect(ret.valueFor(years[0])).toBe(15_000);
    expect(ret.valueFor(years[1])).toBe(12_000);
  });

  it("drops categories that are always zero", () => {
    const accountCategoryById = { a1: "retirement", a2: "real_estate" };
    const years = [
      makeYear({
        year: 2026,
        withdrawals: { byAccount: { a1: 5_000, a2: 0 }, total: 5_000 },
      }),
    ];
    const labels = buildWithdrawalsDatasets(years, accountCategoryById).map((s) => s.label);
    expect(labels).toEqual(["Retirement"]);
  });
});
