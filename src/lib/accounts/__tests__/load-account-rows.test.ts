import { describe, it, expect } from "vitest";
import { buildAccountRows, linkedStatusMapFrom } from "../load-account-rows";
import type { AccountMeta } from "@/lib/scenario/account-meta";
import type { StockOptionPlan } from "@/engine/equity/types";

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
    custodian: null,
    accountNumberLast4: null,
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
      linkedById: new Map(),
      stockOptionPlans: [],
      planStartYear: 2026,
    });

    expect(rows[0].growthSource).toBe("model_portfolio");
    expect(rows[0].modelPortfolioId).toBe("mp-7");
  });

  it("takes custodian and last 4 from meta — the edit dialog round-trips them", () => {
    const rows = buildAccountRows({
      accounts: [engineAccount()],
      familyMembers: [],
      accountMetaById: new Map([
        ["acct-1", meta({ id: "acct-1", custodian: "Brightwater Securities", accountNumberLast4: "3157" })],
      ]),
      linkedById: new Map(),
      stockOptionPlans: [],
      planStartYear: 2026,
    });

    expect(rows[0].custodian).toBe("Brightwater Securities");
    expect(rows[0].accountNumberLast4).toBe("3157");
  });

  it("defaults growthSource to 'default' when the account has no meta row", () => {
    const rows = buildAccountRows({
      accounts: [engineAccount()],
      familyMembers: [],
      accountMetaById: new Map(),
      linkedById: new Map(),
      stockOptionPlans: [],
      planStartYear: 2026,
    });

    expect(rows[0].growthSource).toBe("default");
    expect(rows[0].countsTowardAum).toBe(false);
    expect(rows[0].custodian).toBeNull();
    expect(rows[0].accountNumberLast4).toBeNull();
  });

  it("stringifies the resolved engine growthRate", () => {
    const rows = buildAccountRows({
      accounts: [engineAccount({ growthRate: 0.062 })],
      familyMembers: [],
      accountMetaById: new Map(),
      linkedById: new Map(),
      stockOptionPlans: [],
      planStartYear: 2026,
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
      linkedById: new Map(),
      stockOptionPlans: [],
      planStartYear: 2026,
    });

    expect(rows[0].beneficiaryDisplayName).toBe("Kelly Cooper");
  });

  it("carries the inherited-IRA fields so the edit dialog can't silently un-inherit", () => {
    const rows = buildAccountRows({
      accounts: [engineAccount({ inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945, inheritedHeirDisabled: true, inheritedPayoutFromYear: 2026, inheritedPayoutThroughYear: 2030 })],
      familyMembers: [],
      accountMetaById: new Map([["acct-1", meta({ id: "acct-1" })]]),
      linkedById: new Map(),
      stockOptionPlans: [],
      planStartYear: 2026,
    });
    expect(rows[0]).toMatchObject({ inheritedDeathYear: 2022, inheritedOwnerBirthYear: 1945, inheritedHeirDisabled: true, inheritedPayoutFromYear: 2026, inheritedPayoutThroughYear: 2030 });
  });

  it("defaults the inherited-IRA fields to null/false", () => {
    const rows = buildAccountRows({
      accounts: [engineAccount()],
      familyMembers: [],
      accountMetaById: new Map([["acct-1", meta({ id: "acct-1" })]]),
      linkedById: new Map(),
      stockOptionPlans: [],
      planStartYear: 2026,
    });
    expect(rows[0]).toMatchObject({ inheritedDeathYear: null, inheritedOwnerBirthYear: null, inheritedHeirDisabled: false, inheritedPayoutFromYear: null, inheritedPayoutThroughYear: null });
  });
});

describe("linkedStatusMapFrom", () => {
  it("prefers plaidItemId over the source enum, dating Plaid by the item refresh", () => {
    const map = linkedStatusMapFrom([
      {
        id: "a", plaidItemId: "item-1", externalProvider: null, source: "orion",
        lastSyncedAt: null, plaidRefreshedAt: new Date("2026-10-15T12:00:00Z"), plaidRefreshError: null,
      },
      {
        id: "b", plaidItemId: null, externalProvider: "orion", source: "manual",
        lastSyncedAt: new Date("2026-10-14T19:42:00Z"), plaidRefreshedAt: null, plaidRefreshError: null,
      },
      { id: "c", plaidItemId: null, externalProvider: null, source: "manual" },
    ] as never);

    expect(map.get("a")).toEqual({ source: "plaid", syncedAt: "2026-10-15T12:00:00.000Z", issue: null });
    expect(map.get("b")).toEqual({ source: "orion", syncedAt: "2026-10-14T19:42:00.000Z", issue: null });
    expect(map.has("c")).toBe(false);
  });
});

/** The Net Worth page and the Map's row map are both built here, and both
 *  showed a real equity position as "$0" — the account's stored value never
 *  leaves "0" because the shares live in `stock_option_grants`. */
describe("buildAccountRows — stock_options accounts", () => {
  // Typed, NOT `as never`. The cast this fixture used to carry hid a missing
  // required field from `tsc` completely: when the engine moved from year
  // integers to real dates, this fixture kept `grantYear`/`vestYear`, compiled
  // clean, and crashed at run time inside `yearOf(undefined)`.
  const equityPlan: StockOptionPlan = {
    accountId: "so-1",
    ticker: "TSLA",
    pricePerShare: 100,
    growthRate: 0,
    destinationAccountId: null,
    autoCreateDestination: true,
    sellToCover: false,
    withholdingRate: 0.22,
    strategy: {
      exerciseTiming: "at_vest",
      exerciseYear: null,
      sellTiming: "hold",
      sellYear: null,
      sellPercentPerYear: null,
      sellStartYear: null,
    },
    owner: "client",
    grants: [
      {
        id: "g1",
        grantNumber: "RS-1",
        grantType: "rsu",
        grantDate: "2024-01-15",
        sharesGranted: 1000,
        has83bElection: false,
        fmvAtGrant: null,
        strikePrice: null,
        strikeDiscountPct: null,
        expirationYear: null,
        strategy: null,
        // Vests in 2030, nothing exercised — no pre-plan acquisition to record.
        tranches: [
          { id: "t1", vestDate: "2030-01-15", shares: 1000, sharesExercised: 0, sharesSold: 0,
            acquiredOn: null, priceAtAcquisition: null, strategy: null },
        ],
        plannedEvents: [],
      },
    ],
  };

  const equityAccount = () =>
    engineAccount({ id: "so-1", name: "TSLA Options", category: "stock_options", subType: "rsu", value: 0 });

  it("renders the value of the shares still under grant, not the stored 0", () => {
    const rows = buildAccountRows({
      accounts: [equityAccount()],
      familyMembers: [],
      accountMetaById: new Map(),
      linkedById: new Map(),
      stockOptionPlans: [equityPlan],
      planStartYear: 2026,
    });

    expect(rows[0].value).toBe("100000");
  });

  it("leaves every other account's value alone", () => {
    const rows = buildAccountRows({
      accounts: [engineAccount(), equityAccount()],
      familyMembers: [],
      accountMetaById: new Map(),
      linkedById: new Map(),
      stockOptionPlans: [equityPlan],
      planStartYear: 2026,
    });

    expect(rows[0].value).toBe("400000");
  });
});
