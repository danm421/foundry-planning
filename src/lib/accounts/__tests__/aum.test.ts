import { describe, expect, it } from "vitest";
import { AUM_ELIGIBLE_CATEGORIES, isAumEligible } from "../aum";

// Every value of the `account_category` pgEnum (src/db/schema.ts:59-70), in
// declaration order. If a category is added to the enum without being added
// here, this file is the tripwire: decide deliberately whether it can be
// billed on before it can silently join (or miss) the book.
const ALL_CATEGORIES = [
  "taxable",
  "cash",
  "retirement",
  "annuity",
  "real_estate",
  "business",
  "life_insurance",
  "notes_receivable",
  "stock_options",
  "education_savings",
] as const;

describe("AUM_ELIGIBLE_CATEGORIES", () => {
  it("is exactly the three billable categories", () => {
    expect([...AUM_ELIGIBLE_CATEGORIES]).toEqual(["taxable", "cash", "retirement"]);
  });
});

describe("isAumEligible", () => {
  it("accepts exactly taxable, cash, and retirement", () => {
    expect(ALL_CATEGORIES.filter((c) => isAumEligible(c))).toEqual([
      "taxable",
      "cash",
      "retirement",
    ]);
  });

  it("rejects every other account category", () => {
    expect(ALL_CATEGORIES.filter((c) => !isAumEligible(c))).toEqual([
      "annuity",
      "real_estate",
      "business",
      "life_insurance",
      "notes_receivable",
      "stock_options",
      "education_savings",
    ]);
  });

  it("rejects unknown categories rather than defaulting them in", () => {
    expect(isAumEligible("crypto")).toBe(false);
    expect(isAumEligible("")).toBe(false);
  });
});
