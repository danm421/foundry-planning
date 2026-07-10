import { describe, it, expect } from "vitest";
import { factsToCalcInput, runCalc, resolveLtcg, type AdapterContext } from "../adapter";
import { params2025, retireeMfj } from "./fixtures";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";

const ctx: AdapterContext = { taxParams: params2025, primaryAge: 72, spouseAge: 72 };

describe("factsToCalcInput", () => {
  it("maps 1040 lines onto CalcInput buckets", () => {
    const { input, notes } = factsToCalcInput(retireeMfj(), ctx);
    expect(input.year).toBe(2025);
    expect(input.filingStatus).toBe("married_joint");
    expect(input.earnedIncome).toBe(0);
    expect(input.interestIncome).toBe(8000);
    // ordinary = IRA taxable 90000 + non-qualified dividends (18000-15000)
    expect(input.ordinaryIncome).toBe(93000);
    expect(input.qualifiedDividends).toBe(15000);
    expect(input.longTermCapitalGains).toBe(20000);
    expect(input.shortTermCapitalGains).toBe(0);
    expect(input.socialSecurityGross).toBe(62000);
    expect(input.taxExemptInterest).toBe(12000);
    expect(input.itemizedDeductions).toBe(0); // standard taken
    expect(input.retirementBreakdown).toEqual({ db: 0, ira: 90000, k401: 0, annuity: 0 });
    expect(input.primaryAge).toBe(72);
    expect(notes).toEqual([]);
  });

  it("falls back to line 7 when Schedule D split is missing, with a note", () => {
    const f = retireeMfj();
    f.income.netLongTermGain = null;
    f.income.netShortTermGain = null;
    const { input, notes } = factsToCalcInput(f, ctx);
    expect(input.longTermCapitalGains).toBe(20000);
    expect(notes.length).toBe(1);
  });

  it("inverts QBI deduction to qbiIncome", () => {
    const f = retireeMfj();
    f.deductions.qbiDeduction = 4000;
    const { input } = factsToCalcInput(f, ctx);
    expect(input.qbiIncome).toBe(20000);
  });
});

describe("runCalc", () => {
  it("returns null without a filing status", () => {
    expect(runCalc(emptyTaxReturnFacts(2025), ctx)).toBeNull();
  });

  it("runs calculateTaxYear end-to-end on the retiree persona", () => {
    const r = runCalc(retireeMfj(), ctx);
    expect(r).not.toBeNull();
    expect(r!.flow.taxableIncome).toBeGreaterThan(100000);
    expect(r!.diag.marginalFederalRate).toBeGreaterThan(0);
  });
});

describe("resolveLtcg", () => {
  it("short-term-only: detail present, long null -> 0, NOT capitalGainOrLoss", () => {
    const f = retireeMfj();
    f.income.netLongTermGain = null;
    f.income.netShortTermGain = 3000;
    // capitalGainOrLoss (line 7) is stale/unrelated data that must NOT be used
    // once Schedule D detail is present in any form.
    f.income.capitalGainOrLoss = 20000;
    expect(resolveLtcg(f)).toBe(0);
  });
});
