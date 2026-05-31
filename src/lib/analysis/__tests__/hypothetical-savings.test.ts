import { describe, it, expect } from "vitest";
import {
  buildHypotheticalSavings,
  SYNTHETIC_SAVINGS_ACCOUNT_ID,
  SYNTHETIC_SAVINGS_RULE_ID,
  type GrowthResolverLike,
} from "../hypothetical-savings";
import type { ResolvedCategoryDefault } from "@/lib/projection/resolve-growth-source";

// Minimal fake resolver matching the surface buildHypotheticalSavings uses
// (a structural subset of createGrowthSourceResolver's return value).
function fakeResolver(taxableDefault?: ResolvedCategoryDefault): GrowthResolverLike {
  return {
    resolveCategoryDefault: (_cat) =>
      taxableDefault ?? {
        rate: 0.05,
        realization: {
          pctOrdinaryIncome: 0.1,
          pctLtCapitalGains: 0.6,
          pctQualifiedDividends: 0.2,
          pctTaxExempt: 0.1,
          turnoverPct: 0,
        },
      },
    resolvePortfolio: (_id) => ({
      geoReturn: 0.062,
      pctOi: 0.15,
      pctLtcg: 0.55,
      pctQdiv: 0.2,
      pctTaxEx: 0.1,
    }),
  };
}

describe("buildHypotheticalSavings", () => {
  const window = { startYear: 2026, endYear: 2040, ownerFamilyMemberId: "fm-client" };

  it("taxable-default → uses category-default rate + realization", () => {
    const { account, rule } = buildHypotheticalSavings(
      { kind: "taxable-default" },
      fakeResolver(),
      window,
    );
    expect(account.id).toBe(SYNTHETIC_SAVINGS_ACCOUNT_ID);
    expect(account.category).toBe("taxable");
    expect(account.value).toBe(0);
    expect(account.basis).toBe(0);
    expect(account.growthRate).toBeCloseTo(0.05, 5);
    expect(account.realization?.pctLtCapitalGains).toBeCloseTo(0.6, 5);
    expect(account.owners[0]).toMatchObject({ kind: "family_member", familyMemberId: "fm-client", percent: 1 });
    expect(rule.id).toBe(SYNTHETIC_SAVINGS_RULE_ID);
    expect(rule.accountId).toBe(SYNTHETIC_SAVINGS_ACCOUNT_ID);
    expect(rule.annualAmount).toBe(0); // solver sets the amount
    expect(rule.fundFromExpenseReduction).toBe(true);
    expect(rule.isDeductible).toBe(false); // post-tax contribution
    expect(rule.startYear).toBe(2026);
    expect(rule.endYear).toBe(2040);
  });

  it("model-portfolio → uses portfolio blended return + realization", () => {
    const { account } = buildHypotheticalSavings(
      { kind: "model-portfolio", portfolioId: "p1" },
      fakeResolver(),
      window,
    );
    expect(account.growthRate).toBeCloseTo(0.062, 5);
    expect(account.realization?.pctOrdinaryIncome).toBeCloseTo(0.15, 5);
    expect(account.realization?.pctLtCapitalGains).toBeCloseTo(0.55, 5);
    expect(account.realization?.turnoverPct).toBe(0);
  });

  it("custom-rate → flat rate, NO realization (matches custom taxable account)", () => {
    const { account } = buildHypotheticalSavings(
      { kind: "custom-rate", rate: 0.07 },
      fakeResolver(),
      window,
    );
    expect(account.growthRate).toBeCloseTo(0.07, 5);
    expect(account.realization).toBeUndefined();
  });

  it("taxable-default with no realization (custom-rate category default) → no realization", () => {
    const resolver = fakeResolver({ rate: 0.045 });
    const { account } = buildHypotheticalSavings({ kind: "taxable-default" }, resolver, window);
    expect(account.growthRate).toBeCloseTo(0.045, 5);
    expect(account.realization).toBeUndefined();
  });
});
