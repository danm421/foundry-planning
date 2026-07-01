import { describe, it, expect } from "vitest";
import { buildQuickAddAccount } from "../quick-add-account";

describe("buildQuickAddAccount — activation", () => {
  it("stamps activationYear/activationYearRef onto the account", () => {
    const { account } = buildQuickAddAccount({
      type: "cash", ownerFamilyMemberId: "fm1", ownerLabel: "Client",
      annualAmount: 0, startYear: 2025, endYear: 2045, growthRate: 0.02,
      accountId: "acc1", ruleId: "rule1",
      activationYear: 2035, activationYearRef: null,
    });
    expect(account.activationYear).toBe(2035);
    expect(account.activationYearRef).toBeNull();
  });
});
