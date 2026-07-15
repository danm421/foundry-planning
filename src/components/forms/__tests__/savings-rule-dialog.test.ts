import { describe, it, expect } from "vitest";
import {
  isSavingsEligibleAccount,
  type SavingsRuleAccount,
} from "../savings-rule-dialog";

const acct = (over: Partial<SavingsRuleAccount>): SavingsRuleAccount => ({
  id: "a1",
  name: "Account",
  category: "taxable",
  subType: "brokerage",
  ...over,
});

describe("isSavingsEligibleAccount", () => {
  it("treats liquid household-owned accounts as valid savings targets", () => {
    expect(isSavingsEligibleAccount(acct({ category: "taxable" }))).toBe(true);
    expect(isSavingsEligibleAccount(acct({ category: "cash" }))).toBe(true);
    expect(isSavingsEligibleAccount(acct({ category: "retirement" }))).toBe(true);
  });

  it("treats a 529 (education_savings) as a valid savings target", () => {
    // A 529 is a savings vehicle — the engine credits savings-rule
    // contributions to it (see engine/__tests__/education-529-contributions).
    // 529s carry no ownerEntityId (they're beneficiary-owned), so they must
    // be selectable in the savings-target dropdown.
    expect(
      isSavingsEligibleAccount(acct({ category: "education_savings", subType: "529" })),
    ).toBe(true);
  });

  it("excludes illiquid / non-savings categories", () => {
    for (const category of [
      "real_estate",
      "business",
      "life_insurance",
      "notes_receivable",
      "stock_options",
      "annuity",
    ]) {
      expect(isSavingsEligibleAccount(acct({ category }))).toBe(false);
    }
  });

  it("excludes trust/entity-owned accounts even when the category is liquid", () => {
    expect(
      isSavingsEligibleAccount(acct({ category: "taxable", ownerEntityId: "trust-1" })),
    ).toBe(false);
    expect(
      isSavingsEligibleAccount(acct({ category: "education_savings", ownerEntityId: "trust-1" })),
    ).toBe(false);
  });
});
