import { describe, it, expect } from "vitest";
import {
  buildQuickAddAccount,
  defaultAccountName,
  QUICK_ADD_TYPE_MAP,
  buildAdditionalSavingsAccount,
  buildSavingsRuleForAccount,
  buildQuickAdd529,
} from "../quick-add-account";
import { EDUCATION_529_SENTINEL_OWNER_ID } from "@/engine/ownership";

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
    // Solo ownership is a fraction (engine ownersForYear validates owners sum to 1, not 100).
    expect(account.owners).toEqual([{ kind: "family_member", familyMemberId: "fm-1", percent: 1 }]);
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

describe("additional-savings account (min-savings solve)", () => {
  it("builds a real taxable account with a fundFromExpenseReduction rule at $0", () => {
    const { account, rule } = buildAdditionalSavingsAccount({
      ownerFamilyMemberId: "fm-1",
      startYear: 2026, endYear: 2040, growthRate: 0.06,
      accountId: "acct", ruleId: "rule",
    });
    expect(account).toMatchObject({ category: "taxable", subType: "brokerage", name: "Additional Savings", value: 0 });
    // Solo owner must be a fraction summing to 1 — a percent of 100 makes the
    // engine's ownersForYear throw "sum to 100, expected 1" on every projection.
    expect(account.owners).toEqual([{ kind: "family_member", familyMemberId: "fm-1", percent: 1 }]);
    expect(rule).toMatchObject({ accountId: "acct", annualAmount: 0, isDeductible: false, fundFromExpenseReduction: true });
  });

  it("stamps an optional realization onto the synthetic account", () => {
    const { account } = buildAdditionalSavingsAccount({
      ownerFamilyMemberId: "fm-1",
      startYear: 2026,
      endYear: 2039,
      growthRate: 0.062,
      accountId: "acct",
      ruleId: "rule",
      realization: {
        pctOrdinaryIncome: 0.1,
        pctLtCapitalGains: 0.7,
        pctQualifiedDividends: 0.15,
        pctTaxExempt: 0.05,
        turnoverPct: 0,
      },
    });
    expect(account.growthRate).toBeCloseTo(0.062, 6);
    expect(account.realization).toMatchObject({ pctLtCapitalGains: 0.7, turnoverPct: 0 });
  });

  it("omits realization when not supplied (back-compat)", () => {
    const { account } = buildAdditionalSavingsAccount({
      ownerFamilyMemberId: "fm-1",
      startYear: 2026,
      endYear: 2039,
      growthRate: 0.05,
      accountId: "acct",
      ruleId: "rule",
    });
    expect(account.realization).toBeUndefined();
  });
});

describe("buildSavingsRuleForAccount", () => {
  const base = { annualAmount: 5000, startYear: 2026, endYear: 2045, ruleId: "rule-1" };

  it("builds a non-deductible rule for a taxable brokerage", () => {
    const rule = buildSavingsRuleForAccount({
      account: { id: "a1", category: "taxable", subType: "brokerage" },
      ...base,
    });
    expect(rule).toMatchObject({
      id: "rule-1",
      accountId: "a1",
      annualAmount: 5000,
      isDeductible: false,
      startYear: 2026,
      endYear: 2045,
    });
    expect(rule.rothPercent).toBeUndefined();
  });

  it("builds a non-deductible rule for a cash account", () => {
    const rule = buildSavingsRuleForAccount({
      account: { id: "a2", category: "cash", subType: "checking" },
      ...base,
    });
    expect(rule.isDeductible).toBe(false);
    expect(rule.rothPercent).toBeUndefined();
  });

  it("builds a deductible rule for a traditional IRA", () => {
    const rule = buildSavingsRuleForAccount({
      account: { id: "a3", category: "retirement", subType: "traditional_ira" },
      ...base,
    });
    expect(rule.isDeductible).toBe(true);
    expect(rule.rothPercent).toBeUndefined();
  });

  it("builds a deductible, pre-tax rule for a 401k (Roth split left to the toggle)", () => {
    const rule = buildSavingsRuleForAccount({
      account: { id: "a4", category: "retirement", subType: "401k" },
      ...base,
    });
    expect(rule.isDeductible).toBe(true);
    expect(rule.rothPercent).toBeUndefined();
  });

  it("builds an after-tax, fully-Roth rule for a Roth IRA", () => {
    const rule = buildSavingsRuleForAccount({
      account: { id: "a5", category: "retirement", subType: "roth_ira" },
      ...base,
    });
    expect(rule.isDeductible).toBe(false);
    expect(rule.rothPercent).toBe(1);
  });

  it("treats retirement 'other' / 529 as non-deductible (advisor asserts manually)", () => {
    expect(
      buildSavingsRuleForAccount({
        account: { id: "a6", category: "retirement", subType: "other" },
        ...base,
      }).isDeductible,
    ).toBe(false);
    expect(
      buildSavingsRuleForAccount({
        account: { id: "a7", category: "retirement", subType: "529" },
        ...base,
      }).isDeductible,
    ).toBe(false);
  });
});

describe("buildQuickAdd529", () => {
  const base = {
    accountId: "acct-529",
    ruleId: "rule-529",
    name: "Ava — 529 Plan",
    beneficiaryFamilyMemberId: "fm-ava",
    balance: 15000,
    annualAmount: 6000,
    growthRate: 0.06,
    startYear: 2026,
    endYear: 2035,
  };

  it("builds an education_savings/529 account with the sentinel owner and beneficiary", () => {
    const { account } = buildQuickAdd529(base);
    expect(account).toMatchObject({
      id: "acct-529",
      name: "Ava — 529 Plan",
      category: "education_savings",
      subType: "529",
      value: 15000,
      basis: 15000,
      growthRate: 0.06,
      rmdEnabled: false,
      titlingType: "jtwros",
    });
    expect(account.owners).toEqual([
      { kind: "external_beneficiary", externalBeneficiaryId: EDUCATION_529_SENTINEL_OWNER_ID, percent: 1 },
    ]);
    expect(account.education529).toMatchObject({
      beneficiaryFamilyMemberId: "fm-ava",
      grantorFamilyMemberId: null,
      rothRolloverEnabled: false,
    });
  });

  it("builds a non-deductible savings rule spanning start→end when contribution > 0", () => {
    const { rule } = buildQuickAdd529(base);
    expect(rule).toMatchObject({
      id: "rule-529",
      accountId: "acct-529",
      annualAmount: 6000,
      isDeductible: false,
      startYear: 2026,
      endYear: 2035,
    });
    expect(rule?.rothPercent).toBeUndefined();
  });

  it("returns a null rule when the annual contribution is 0", () => {
    const { rule } = buildQuickAdd529({ ...base, annualAmount: 0 });
    expect(rule).toBeNull();
  });
});
