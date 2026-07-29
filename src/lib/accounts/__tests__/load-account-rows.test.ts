import { describe, it, expect } from "vitest";
import { buildAccountRows, linkedSourceMapFrom } from "../load-account-rows";
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
    countsTowardAum: false,
    ...overrides,
  };
}

// Minimal engine-account stand-in. `buildAccountRows` only reads these fields.
function engineAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: "acct-1",
    name: "IRA",
    category: "retirement",
    subType: "traditional_ira",
    value: 400000,
    basis: 0,
    rothValue: 0,
    growthRate: 0.062,
    rmdEnabled: true,
    isDefaultChecking: false,
    owners: [],
    titlingType: "jtwros",
    parentAccountId: null,
    ...overrides,
  } as never;
}

describe("buildAccountRows", () => {
  it("takes growthSource and modelPortfolioId from meta, not the engine account", () => {
    const rows = buildAccountRows({
      accounts: [engineAccount()],
      familyMembers: [],
      accountMetaById: new Map([
        ["acct-1", meta({ id: "acct-1", growthSource: "model_portfolio", modelPortfolioId: "mp-7" })],
      ]),
      linkedSourceById: new Map(),
    });

    expect(rows[0].growthSource).toBe("model_portfolio");
    expect(rows[0].modelPortfolioId).toBe("mp-7");
  });

  it("defaults growthSource to 'default' when the account has no meta row", () => {
    const rows = buildAccountRows({
      accounts: [engineAccount()],
      familyMembers: [],
      accountMetaById: new Map(),
      linkedSourceById: new Map(),
    });

    expect(rows[0].growthSource).toBe("default");
    expect(rows[0].countsTowardAum).toBe(false);
  });

  it("stringifies the resolved engine growthRate", () => {
    const rows = buildAccountRows({
      accounts: [engineAccount({ growthRate: 0.062 })],
      familyMembers: [],
      accountMetaById: new Map(),
      linkedSourceById: new Map(),
    });

    expect(rows[0].growthRate).toBe("0.062");
  });

  it("resolves a 529 beneficiary display name from family members", () => {
    const rows = buildAccountRows({
      accounts: [
        engineAccount({
          id: "acct-529",
          category: "education_savings",
          education529: { beneficiaryFamilyMemberId: "fm-kid", beneficiaryName: null },
        }),
      ],
      familyMembers: [{ id: "fm-kid", role: "child", firstName: "Kelly", lastName: "Cooper" }],
      accountMetaById: new Map(),
      linkedSourceById: new Map(),
    });

    expect(rows[0].beneficiaryDisplayName).toBe("Kelly Cooper");
  });
});

describe("linkedSourceMapFrom", () => {
  it("prefers plaidItemId over the source enum", () => {
    const map = linkedSourceMapFrom([
      { id: "a", plaidItemId: "item-1", externalProvider: null, source: "orion" },
      { id: "b", plaidItemId: null, externalProvider: "orion", source: "manual" },
      { id: "c", plaidItemId: null, externalProvider: null, source: "manual" },
    ] as never);

    expect(map.get("a")).toBe("plaid");
    expect(map.get("b")).toBe("orion");
    expect(map.has("c")).toBe(false);
  });
});
