import { describe, expect, it } from "vitest";
import { accountCategoryEnum } from "@/db/schema";
import { AUM_ELIGIBLE_CATEGORIES, isAumEligible } from "../aum";

// Read from the enum itself, in declaration order, so this list cannot drift
// from it. Adding a category to the enum fails the assertions below, which is
// the point: decide deliberately whether it can be billed on before it can
// silently join (or miss) the book.
const ALL_CATEGORIES = accountCategoryEnum.enumValues;

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
