import { describe, it, expect } from "vitest";
import { buildAccountRows } from "../load-account-rows";
import type { AccountMeta } from "@/lib/scenario/account-meta";

function meta(overrides: Partial<AccountMeta> & { id: string }): AccountMeta {
  return {
    growthSource: null,
    modelPortfolioId: null,
    tickerPortfolioId: null,
    turnoverPct: null,
    overridePctOi: null,
    overridePctLtCg: null,
    overridePctQdiv: null,
    overridePctTaxExempt: null,
    annualPropertyTax: null,
    propertyTaxGrowthRate: null,
    propertyTaxGrowthSource: null,
    notes: null,
    growthRate: null,
    countsTowardAum: false,
    ...overrides,
  };
}

function business(overrides: Record<string, unknown> = {}) {
  return {
    id: "biz-1",
    name: "Acme LLC",
    category: "business",
    subType: "s_corp",
    value: 500000,
    basis: 100000,
    growthRate: 0.06,
    owners: [],
    titlingType: "jtwros",
    parentAccountId: null,
    businessType: "s_corp",
    businessTaxTreatment: "ordinary",
    distributionPolicyPercent: 0.4,
    flowMode: "schedule",
    ...overrides,
  } as never;
}

const args = {
  familyMembers: [],
  linkedSourceById: new Map(),
  stockOptionPlans: [],
  planStartYear: 2026,
};

describe("buildAccountRows — business fields", () => {
  it("forwards the business type, tax treatment, distribution, flow mode and notes", () => {
    const [row] = buildAccountRows({
      ...args,
      accounts: [business()],
      accountMetaById: new Map([["biz-1", meta({ id: "biz-1", notes: "Buy-sell signed 2024" })]]),
    });

    expect(row.businessType).toBe("s_corp");
    expect(row.businessTaxTreatment).toBe("ordinary");
    expect(row.distributionPolicyPercent).toBe("0.4");
    expect(row.flowMode).toBe("schedule");
    expect(row.notes).toBe("Buy-sell signed 2024");
  });

  it("forwards the business's STORED growth rate, which the resolved row rate cannot show", () => {
    // A legacy row: growth_source defaulted to "default" with no backfill, yet
    // the projection honours its stored 8% (resolveAccountFromRaw's business
    // rule). The resolved rate alone can't tell a stored 8% from a plan default.
    const [row] = buildAccountRows({
      ...args,
      accounts: [business({ growthRate: 0.08 })],
      accountMetaById: new Map([
        ["biz-1", meta({ id: "biz-1", growthSource: "default", growthRate: "0.0800" })],
      ]),
    });

    expect(row.growthSource).toBe("default");
    expect(row.storedGrowthRate).toBe("0.0800");
  });

  it("leaves a null distribution null and a missing notes row null", () => {
    const [row] = buildAccountRows({
      ...args,
      accounts: [business({ distributionPolicyPercent: null })],
      accountMetaById: new Map(),
    });

    expect(row.distributionPolicyPercent).toBeNull();
    expect(row.notes).toBeNull();
    expect(row.storedGrowthRate).toBeNull();
  });
});
