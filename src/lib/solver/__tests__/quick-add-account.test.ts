import { describe, it, expect } from "vitest";
import { buildQuickAddAccount, defaultAccountName, QUICK_ADD_TYPE_MAP } from "../quick-add-account";

describe("quick-add account builder", () => {
  const args = {
    type: "roth_ira" as const,
    ownerFamilyMemberId: "fm-1",
    ownerLabel: "John",
    annualAmount: 7000,
    startYear: 2026,
    endYear: 2045,
    growthRate: 0.06,
    accountId: "acct-uuid",
    ruleId: "rule-uuid",
  };

  it("maps each type to engine category/subType/deductible", () => {
    expect(QUICK_ADD_TYPE_MAP.taxable).toMatchObject({ category: "taxable", subType: "brokerage", isDeductible: false });
    expect(QUICK_ADD_TYPE_MAP.ira).toMatchObject({ category: "retirement", subType: "ira", isDeductible: true });
    expect(QUICK_ADD_TYPE_MAP.roth_ira).toMatchObject({ category: "retirement", subType: "roth_ira", isDeductible: false });
    expect(QUICK_ADD_TYPE_MAP.cash).toMatchObject({ category: "cash", subType: "checking", isDeductible: false });
  });

  it("auto-composes the name", () => {
    expect(defaultAccountName("John", "roth_ira")).toBe("John — Roth IRA");
    expect(defaultAccountName("Jane", "ira")).toBe("Jane — IRA");
  });

  it("builds a valid account + rule with sane defaults", () => {
    const { account, rule } = buildQuickAddAccount(args);
    expect(account).toMatchObject({
      id: "acct-uuid", name: "John — Roth IRA", category: "retirement", subType: "roth_ira",
      value: 0, basis: 0, growthRate: 0.06, rmdEnabled: false, titlingType: "jtwros",
    });
    expect(account.owners).toEqual([{ kind: "family_member", familyMemberId: "fm-1", percent: 100 }]);
    expect(rule).toMatchObject({
      id: "rule-uuid", accountId: "acct-uuid", annualAmount: 7000,
      isDeductible: false, startYear: 2026, endYear: 2045, rothPercent: 1,
    });
  });

  it("sets rmdEnabled only for traditional IRA", () => {
    expect(buildQuickAddAccount({ ...args, type: "ira" }).account.rmdEnabled).toBe(true);
    expect(buildQuickAddAccount({ ...args, type: "taxable" }).account.rmdEnabled).toBe(false);
  });
});
