import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings } from "./fixtures";

describe("living-expense inflation override — projection integration", () => {
  const OVERRIDE = 0.1;
  const baseData = buildClientData();
  const stressData = buildClientData({
    planSettings: { ...basePlanSettings, livingExpenseInflationOverride: OVERRIDE },
  });

  const baseRun = runProjection(baseData);
  const stressRun = runProjection(stressData);

  const findYear = (rows: typeof baseRun, y: number) => rows.find((r) => r.year === y)!;

  it("grows living expenses at the override rate instead of their resolved rate", () => {
    // exp-living: $80k from 2026 at 3%. Under the override it compounds at 10%.
    for (const year of [2027, 2030]) {
      const elapsed = year - 2026;
      const expected =
        findYear(baseRun, year).expenses.living *
        Math.pow(1.1 / 1.03, elapsed);
      expect(findYear(stressRun, year).expenses.living).toBeCloseTo(expected, 4);
    }
  });

  it("leaves non-living expenses untouched", () => {
    // exp-insurance: $5k at 2% — must be identical in both runs.
    for (const year of [2027, 2030, 2040]) {
      expect(findYear(stressRun, year).expenses.insurance).toBeCloseTo(
        findYear(baseRun, year).expenses.insurance,
        6,
      );
    }
  });

  it("does not perturb the first projection year", () => {
    expect(findYear(stressRun, 2026).expenses.living).toBeCloseTo(
      findYear(baseRun, 2026).expenses.living,
      6,
    );
  });
});
