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

  // `parseRowFacts` re-validates already-persisted jsonb on every read, so a
  // row written before `income.scheduleE` existed must still parse. These two
  // tests are a pair on purpose: the first proves the new key is optional on
  // input, the second proves the schema did NOT become lenient about missing
  // keys generally — without it, the first would pass even if `.strict()` had
  // been dropped entirely.
  it("accepts a persisted facts blob written before income.scheduleE existed", () => {
    const legacy = emptyTaxReturnFacts(2025) as Record<string, unknown>;
    const income = { ...(legacy.income as Record<string, unknown>) };
    delete income.scheduleE;
    legacy.income = income;
    expect("scheduleE" in income).toBe(false);

    const parsed = taxReturnFactsSchema.safeParse(legacy);
    expect(parsed.success).toBe(true);
    // Defaulted, not merely absent — downstream reads `.scheduleE` unguarded.
    expect(parsed.success && parsed.data.income.scheduleE).toBeNull();
  });

  it("still rejects a facts blob missing a pre-existing income key", () => {
    const broken = emptyTaxReturnFacts(2025) as Record<string, unknown>;
    const income = { ...(broken.income as Record<string, unknown>) };
    delete income.wages;
    broken.income = income;
    expect(taxReturnFactsSchema.safeParse(broken).success).toBe(false);
  });

  it("accepts a populated Schedule E block and rejects unknown keys in it", () => {
    const facts = emptyTaxReturnFacts(2025);
    facts.income.scheduleENet = -6141;
    facts.income.scheduleE = {
      grossRents: 19600, totalExpenses: 25741, depreciation: 8413,
      mortgageInterest: 6210, propertyTaxes: 5024, suspendedPassiveLoss: 0,
    };
    expect(taxReturnFactsSchema.safeParse(facts).success).toBe(true);

    const bogus = {
      ...facts,
      income: { ...facts.income, scheduleE: { ...facts.income.scheduleE, netRent: 1 } },
    };
    expect(taxReturnFactsSchema.safeParse(bogus).success).toBe(false);
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
