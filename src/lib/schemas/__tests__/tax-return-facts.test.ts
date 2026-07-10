import { describe, it, expect } from "vitest";
import {
  taxReturnFactsSchema,
  emptyTaxReturnFacts,
  TAX_RETURN_MIN_YEAR,
} from "../tax-return-facts";

describe("taxReturnFactsSchema", () => {
  it("accepts an empty facts object for a valid year", () => {
    const empty = emptyTaxReturnFacts(2025);
    const parsed = taxReturnFactsSchema.safeParse(empty);
    expect(parsed.success).toBe(true);
    expect(empty.taxYear).toBe(2025);
    expect(empty.income.wages).toBeNull();
    expect(empty.deductions.scheduleA).toBeNull();
  });

  it("rejects years below TAX_RETURN_MIN_YEAR", () => {
    expect(TAX_RETURN_MIN_YEAR).toBe(2022);
    const parsed = taxReturnFactsSchema.safeParse(emptyTaxReturnFacts(2021));
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown keys (strict)", () => {
    const facts = { ...emptyTaxReturnFacts(2024), bogus: 1 };
    expect(taxReturnFactsSchema.safeParse(facts).success).toBe(false);
  });

  it("accepts a fully populated MFJ return", () => {
    const facts = emptyTaxReturnFacts(2025);
    facts.filingStatus = "married_joint";
    facts.residenceState = "PA";
    facts.income.wages = 250000;
    facts.income.qualifiedDividends = 12000;
    facts.deductions.deductionTaken = "itemized";
    facts.deductions.scheduleA = {
      saltPaid: 28000, saltDeducted: 10000, mortgageInterest: 9000,
      charitableCash: 15000, charitableNonCash: 2000, medical: 0,
    };
    facts.tax.totalTax = 41180;
    expect(taxReturnFactsSchema.safeParse(facts).success).toBe(true);
  });
});
