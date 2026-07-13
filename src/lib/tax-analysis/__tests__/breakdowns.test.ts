import { describe, it, expect } from "vitest";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import {
  buildIncomeComposition,
  buildDeductionDetail,
  deductionDetailRows,
  incomeCompositionTotal,
} from "../breakdowns";
import { buildTaxAnalysis } from "../analysis";
import { createTaxResolver } from "@/lib/tax/resolver";
import { params2025, retireeMfj, highEarnerMfj } from "./fixtures";

describe("buildIncomeComposition", () => {
  it("returns present rows in 1040 line order with % of the summed total (retiree: no totalIncome extracted)", () => {
    const rows = buildIncomeComposition(retireeMfj())!;
    // 1040 order: 2b interest, 3b dividends, 4b IRA, 6b SS, 7 capital gains
    expect(rows.map((r) => r.key)).toEqual([
      "taxableInterest", "dividends", "ira", "socialSecurity", "capitalGains",
    ]);
    // denominator = sum of rows = 8000 + 18000 + 20000 + 90000 + 52700 = 188700
    const ira = rows.find((r) => r.key === "ira")!;
    expect(ira.amount).toBe(90000);
    expect(ira.pctOfTotal).toBeCloseTo(90000 / 188700, 5);
  });

  it("uses income.totalIncome as the denominator when extracted", () => {
    const f = retireeMfj();
    f.income.totalIncome = 200000;
    const ira = buildIncomeComposition(f)!.find((r) => r.key === "ira")!;
    expect(ira.pctOfTotal).toBeCloseTo(90000 / 200000, 5);
  });

  it("negative rows keep their sign in amount and pct", () => {
    const f = retireeMfj();
    f.income.scheduleENet = -6141;
    const rental = buildIncomeComposition(f)!.find((r) => r.key === "rental")!;
    expect(rental.amount).toBe(-6141);
    expect(rental.pctOfTotal).toBeLessThan(0);
  });

  it("omits the % when the denominator is not positive", () => {
    const f = emptyTaxReturnFacts(2025);
    f.income.capitalGainOrLoss = -3000;
    const rows = buildIncomeComposition(f)!;
    expect(rows).toHaveLength(1);
    expect(rows[0].pctOfTotal).toBeNull();
  });

  it("returns null when no income fields are present", () => {
    expect(buildIncomeComposition(emptyTaxReturnFacts(2025))).toBeNull();
  });
});

describe("incomeCompositionTotal", () => {
  it("returns null when line 9 was not extracted (gates the total row off)", () => {
    expect(incomeCompositionTotal(null)).toBeNull();
  });

  it("formats a positive total at 100%", () => {
    expect(incomeCompositionTotal(195700)).toEqual({ amount: "$195,700", pct: "100%" });
  });

  it("shows an em dash for the % of a loss-year (non-positive) total", () => {
    expect(incomeCompositionTotal(-5000)).toEqual({ amount: "-$5,000", pct: "—" });
    expect(incomeCompositionTotal(0)).toEqual({ amount: "$0", pct: "—" });
  });
});

describe("buildDeductionDetail", () => {
  it("derives saltLostToCap for an itemized return (32,000 paid − 10,000 deducted)", () => {
    const d = buildDeductionDetail(highEarnerMfj())!;
    expect(d.deductionTaken).toBe("itemized");
    expect(d.scheduleA?.saltLostToCap).toBe(22000);
  });

  it("keeps a standard-deduction return without Schedule A", () => {
    const d = buildDeductionDetail(retireeMfj())!;
    expect(d.deductionTaken).toBe("standard");
    expect(d.deductionAmount).toBe(33200);
    expect(d.scheduleA).toBeNull();
  });

  it("saltLostToCap is null when SALT wasn't capped", () => {
    const f = highEarnerMfj();
    f.deductions.scheduleA!.saltPaid = 9000;
    f.deductions.scheduleA!.saltDeducted = 9000;
    expect(buildDeductionDetail(f)!.scheduleA?.saltLostToCap).toBeNull();
  });

  it("returns null when every constituent is null", () => {
    expect(buildDeductionDetail(emptyTaxReturnFacts(2025))).toBeNull();
  });
});

describe("deductionDetailRows", () => {
  it("renders label/value rows, skipping nulls, with formatted dollars", () => {
    const rows = deductionDetailRows(buildDeductionDetail(highEarnerMfj())!);
    expect(rows).toContainEqual({ label: "Deduction taken", value: "Itemized" });
    expect(rows).toContainEqual({ label: "SALT lost to the cap", value: "$22,000" });
    expect(rows).toContainEqual({ label: "Deduction amount (12)", value: "$36,000" });
    expect(rows.find((r) => r.label === "QBI deduction (13)")).toBeUndefined(); // null skipped
  });
});

describe("buildTaxAnalysis wiring", () => {
  it("attaches incomeComposition and deductionDetail to the analysis bundle", () => {
    const resolver = createTaxResolver([params2025], { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 });
    const a = buildTaxAnalysis({ facts: highEarnerMfj(), prior: null, resolver, primaryAge: 45, spouseAge: 45 });
    expect(a.incomeComposition?.length).toBeGreaterThan(0);
    expect(a.deductionDetail?.scheduleA?.saltLostToCap).toBe(22000);
  });
});
