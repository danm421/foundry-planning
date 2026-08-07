import { describe, it, expect } from "vitest";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import {
  buildIncomeComposition,
  buildDeductionDetail,
  deductionDetailRows,
  hasGrossColumn,
  incomeCompositionTotal,
} from "../breakdowns";
import { buildGrossIncome } from "../gross-income";
import { buildTaxAnalysis } from "../analysis";
import { createTaxResolver } from "@/lib/tax/resolver";
import { params2025, retireeMfj, highEarnerMfj, landlordSingle } from "./fixtures";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";

/** buildIncomeComposition takes the gross bundle rather than re-deriving it, so
 *  the analysis can build it once. Tests pair the two the same way. */
const composition = (f: TaxReturnFacts) => buildIncomeComposition(f, buildGrossIncome(f));

describe("buildIncomeComposition", () => {
  it("returns present rows in 1040 line order with % of the summed gross (retiree: no totalIncome extracted)", () => {
    const rows = composition(retireeMfj())!;
    // 1040 order: 2b interest, 3b dividends, 4b IRA, 6b SS, 7 capital gains
    expect(rows.map((r) => r.key)).toEqual([
      "taxableInterest", "dividends", "ira", "socialSecurity", "capitalGains",
    ]);
    // denominator = sum of GROSS rows: SS shows 6a (62,000) not 6b (52,700), so
    // 8000 + 18000 + 90000 + 62000 + 20000 = 198000
    const ira = rows.find((r) => r.key === "ira")!;
    expect(ira.amount).toBe(90000);
    expect(ira.gross).toBe(90000); // 4a === 4b on this fixture
    expect(ira.pctOfGross).toBeCloseTo(90000 / 198000, 5);
  });

  it("carries the 6a gross beside the 6b amount for Social Security", () => {
    const ss = composition(retireeMfj())!.find((r) => r.key === "socialSecurity")!;
    expect(ss.amount).toBe(52700);
    expect(ss.gross).toBe(62000);
  });

  it("uses the grossed-up total as the denominator when line 9 was extracted", () => {
    const f = retireeMfj();
    f.income.totalIncome = 200000;
    const ira = composition(f)!.find((r) => r.key === "ira")!;
    expect(ira.pctOfGross).toBeCloseTo(90000 / (200000 + 9300), 5); // + the SS uplift
  });

  it("stops wages reading over 100% on a rental-loss return", () => {
    // The bug this column exists for: 124,624 / 118,546 (line 9, net of a 6,141
    // rental loss) rendered as 105.1%.
    const rows = composition(landlordSingle())!;
    const wages = rows.find((r) => r.key === "wages")!;
    expect(wages.pctOfGross).toBeCloseTo(124624 / 144287, 5);
    expect(wages.pctOfGross!).toBeLessThan(1);

    const rental = rows.find((r) => r.key === "rental")!;
    expect(rental.amount).toBe(-6141); // as filed
    expect(rental.gross).toBe(19600);  // rents received
  });

  it("negative rows keep their sign in amount and pct", () => {
    const f = retireeMfj();
    f.income.scheduleENet = -6141; // no scheduleE block, so nothing to gross up
    const rental = composition(f)!.find((r) => r.key === "rental")!;
    expect(rental.amount).toBe(-6141);
    expect(rental.gross).toBe(-6141);
    expect(rental.pctOfGross).toBeLessThan(0);
  });

  it("omits the % when the denominator is not positive", () => {
    const f = emptyTaxReturnFacts(2025);
    f.income.capitalGainOrLoss = -3000;
    const rows = composition(f)!;
    expect(rows).toHaveLength(1);
    expect(rows[0].pctOfGross).toBeNull();
  });

  it("returns null when no income fields are present", () => {
    expect(composition(emptyTaxReturnFacts(2025))).toBeNull();
  });
});

describe("hasGrossColumn", () => {
  it("is true when a source's gross differs from what it put on line 9", () => {
    expect(hasGrossColumn(composition(landlordSingle())!)).toBe(true);
    expect(hasGrossColumn(composition(retireeMfj())!)).toBe(true); // SS 6a vs 6b
  });

  it("is false for a wage-and-portfolio return, keeping the table three columns wide", () => {
    expect(hasGrossColumn(composition(highEarnerMfj())!)).toBe(false);
  });
});

describe("incomeCompositionTotal", () => {
  it("returns null when line 9 was not extracted (gates the total row off)", () => {
    expect(incomeCompositionTotal(null, null)).toBeNull();
  });

  it("formats a positive total at 100%, with the gross beside it", () => {
    expect(incomeCompositionTotal(195700, 205000)).toEqual({
      amount: "$195,700", gross: "$205,000", pct: "100%",
    });
  });

  it("falls back to line 9 as its own gross when no uplift applies", () => {
    expect(incomeCompositionTotal(195700, null)).toEqual({
      amount: "$195,700", gross: "$195,700", pct: "100%",
    });
  });

  it("shows an em dash for the % of a loss-year (non-positive) total", () => {
    expect(incomeCompositionTotal(-5000, -5000)).toEqual({
      amount: "-$5,000", gross: "-$5,000", pct: "—",
    });
    expect(incomeCompositionTotal(0, 0)).toEqual({ amount: "$0", gross: "$0", pct: "—" });
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

  it("exposes grossIncome as a key figure and feeds the same gross to the composition rows", () => {
    const resolver = createTaxResolver([params2025], { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 });
    const a = buildTaxAnalysis({ facts: landlordSingle(), prior: null, resolver, primaryAge: 41, spouseAge: null });
    expect(a.keyFigures.totalIncome).toBe(118546);
    expect(a.keyFigures.grossIncome).toBe(144287);
    // The rows' gross column must reconcile to the same figure the tile shows.
    const summed = a.incomeComposition!.reduce((s, r) => s + r.gross, 0);
    expect(summed).toBe(a.keyFigures.grossIncome);
  });
});
