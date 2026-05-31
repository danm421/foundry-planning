import { describe, it, expect } from "vitest";
import {
  injectHypotheticalSavings,
  formatGrowthLabel,
} from "../inject-hypothetical-savings";
import {
  SYNTHETIC_SAVINGS_ACCOUNT_ID,
  SYNTHETIC_SAVINGS_RULE_ID,
  type GrowthResolverLike,
} from "../hypothetical-savings";
import { earliestRetirementYear } from "../retirement-window";
import type { ClientData } from "@/engine/types";
import type { ResolutionContext } from "@/lib/projection/resolve-entity";

// Minimal tree carrying only the fields injectHypotheticalSavings touches.
function makeTree(): ClientData {
  return {
    accounts: [],
    savingsRules: [],
    planSettings: { planStartYear: 2026 },
    client: { dateOfBirth: "1980-01-01", retirementAge: 65 },
    familyMembers: [{ id: "fm-client", role: "client" }],
  } as unknown as ClientData;
}

// ResolutionContext whose portfolio return is 6.2% (matches hypothetical-savings.test).
function fakeContext(): ResolutionContext {
  const resolver: GrowthResolverLike = {
    resolveCategoryDefault: () => ({ rate: 0.05 }),
    resolvePortfolio: () => ({
      geoReturn: 0.062,
      pctOi: 0.15,
      pctLtcg: 0.55,
      pctQdiv: 0.2,
      pctTaxEx: 0.1,
    }),
  };
  return { resolver, resolvedInflationRate: 0.02 } as unknown as ResolutionContext;
}

describe("injectHypotheticalSavings", () => {
  it("appends exactly one synthetic account + rule using the plan-start → earliest-retirement window", () => {
    const tree = makeTree();
    injectHypotheticalSavings(tree, { kind: "taxable-default" });
    expect(tree.accounts).toHaveLength(1);
    expect(tree.savingsRules).toHaveLength(1);
    const account = tree.accounts[0];
    const rule = tree.savingsRules[0];
    expect(account.id).toBe(SYNTHETIC_SAVINGS_ACCOUNT_ID);
    expect(rule.id).toBe(SYNTHETIC_SAVINGS_RULE_ID);
    expect(rule.accountId).toBe(SYNTHETIC_SAVINGS_ACCOUNT_ID);
    expect(rule.annualAmount).toBe(0); // inert until a savings-contribution mutation raises it
    expect(rule.startYear).toBe(2026);
    expect(rule.endYear).toBe(earliestRetirementYear(tree.client)); // 1980 + 65 = 2045
    expect(account.owners[0]).toMatchObject({ familyMemberId: "fm-client", percent: 1 });
  });

  it("falls back to a flat 5% taxable rate when no resolution context is given", () => {
    const tree = makeTree();
    const { growthLabel } = injectHypotheticalSavings(tree, { kind: "taxable-default" });
    expect(tree.accounts[0].growthRate).toBeCloseTo(0.05, 5);
    expect(growthLabel).toBe("Taxable default 5.0%");
  });

  it("uses the resolver's portfolio return for a model-portfolio growth", () => {
    const tree = makeTree();
    const { growthLabel } = injectHypotheticalSavings(
      tree,
      { kind: "model-portfolio", portfolioId: "p1" },
      fakeContext(),
    );
    expect(tree.accounts[0].growthRate).toBeCloseTo(0.062, 5);
    expect(growthLabel).toBe("Model portfolio · 6.2%");
  });

  it("uses a flat custom rate and labels it Custom", () => {
    const tree = makeTree();
    const { growthLabel } = injectHypotheticalSavings(tree, { kind: "custom-rate", rate: 0.07 });
    expect(tree.accounts[0].growthRate).toBeCloseTo(0.07, 5);
    expect(growthLabel).toBe("Custom 7.0%");
  });
});

describe("formatGrowthLabel", () => {
  it("formats each growth kind", () => {
    expect(formatGrowthLabel({ kind: "taxable-default" }, 0.072)).toBe("Taxable default 7.2%");
    expect(formatGrowthLabel({ kind: "model-portfolio", portfolioId: "p" }, 0.062)).toBe(
      "Model portfolio · 6.2%",
    );
    expect(formatGrowthLabel({ kind: "custom-rate", rate: 0.05 }, 0.05)).toBe("Custom 5.0%");
  });
});
