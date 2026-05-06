import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, EntitySummary } from "../types";

const ENT_IIP = "ent-iip";
const ENT_NON_IIP_LOCKED = "ent-non-iip-locked";
const ENT_NON_IIP_ACCESSIBLE = "ent-non-iip-accessible";

const entities: EntitySummary[] = [
  {
    id: ENT_IIP,
    name: "Revocable Trust",
    entityType: "trust",
    trustSubType: "revocable",
    isIrrevocable: false,
    isGrantor: true,
    includeInPortfolio: true,
    accessibleToClient: false,
    grantor: "client",
  },
  {
    id: ENT_NON_IIP_LOCKED,
    name: "Locked SLAT",
    entityType: "trust",
    trustSubType: "slat",
    isIrrevocable: true,
    isGrantor: false,
    includeInPortfolio: false,
    accessibleToClient: false,
    grantor: "client",
  },
  {
    id: ENT_NON_IIP_ACCESSIBLE,
    name: "HEMS Trust",
    entityType: "trust",
    trustSubType: "ilit",
    isIrrevocable: true,
    isGrantor: false,
    includeInPortfolio: false,
    accessibleToClient: true,
    grantor: "client",
  },
];

function projectWith(accounts: Account[]) {
  // Drop fixture income/expenses/savings/strategy so the engine doesn't try to
  // do household cash-flow accounting against synthetic asset-only setups.
  return runProjection(
    buildClientData({
      accounts,
      entities,
      incomes: [],
      expenses: [],
      savingsRules: [],
      withdrawalStrategy: [],
      liabilities: [],
    }),
  );
}

describe("portfolioAssets buckets — non-IIP entity routing", () => {
  it("real estate owned 100% by household goes to realEstateTotal", () => {
    const acct: Account = {
      id: "re-house",
      name: "Primary Home",
      category: "real_estate",
      subType: "primary_residence",
      value: 800_000,
      basis: 800_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const [year0] = projectWith([acct]);
    expect(year0.portfolioAssets.realEstateTotal).toBe(800_000);
    expect(year0.portfolioAssets.trustsAndBusinessesTotal).toBe(0);
    expect(year0.portfolioAssets.accessibleTrustAssetsTotal).toBe(0);
  });

  it("real estate owned 100% by an IIP entity goes to realEstateTotal", () => {
    const acct: Account = {
      id: "re-iip",
      name: "Trust-held home",
      category: "real_estate",
      subType: "investment",
      value: 500_000,
      basis: 500_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "entity", entityId: ENT_IIP, percent: 1 }],
    };
    const [year0] = projectWith([acct]);
    expect(year0.portfolioAssets.realEstateTotal).toBe(500_000);
    expect(year0.portfolioAssets.trustsAndBusinessesTotal).toBe(0);
    expect(year0.portfolioAssets.accessibleTrustAssetsTotal).toBe(0);
  });

  it("real estate owned 100% by a non-IIP non-accessible entity goes to trustsAndBusinessesTotal", () => {
    const acct: Account = {
      id: "re-flp",
      name: "FLP Rental",
      category: "real_estate",
      subType: "investment",
      value: 600_000,
      basis: 600_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "entity", entityId: ENT_NON_IIP_LOCKED, percent: 1 }],
    };
    const [year0] = projectWith([acct]);
    expect(year0.portfolioAssets.realEstateTotal).toBe(0);
    expect(year0.portfolioAssets.trustsAndBusinessesTotal).toBe(600_000);
    expect(year0.portfolioAssets.accessibleTrustAssetsTotal).toBe(0);
  });

  it("taxable account owned 100% by a non-IIP accessible entity goes to accessibleTrustAssetsTotal", () => {
    const acct: Account = {
      id: "tax-hems",
      name: "HEMS Brokerage",
      category: "taxable",
      subType: "brokerage",
      value: 400_000,
      basis: 400_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "entity", entityId: ENT_NON_IIP_ACCESSIBLE, percent: 1 }],
    };
    const [year0] = projectWith([acct]);
    expect(year0.portfolioAssets.taxableTotal).toBe(0);
    expect(year0.portfolioAssets.trustsAndBusinessesTotal).toBe(0);
    expect(year0.portfolioAssets.accessibleTrustAssetsTotal).toBe(400_000);
  });

  it("50/50 household + non-IIP-accessible entity splits across taxable and accessible buckets", () => {
    const acct: Account = {
      id: "split-tax",
      name: "Mixed Brokerage",
      category: "taxable",
      subType: "brokerage",
      value: 1_000_000,
      basis: 1_000_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
        { kind: "entity", entityId: ENT_NON_IIP_ACCESSIBLE, percent: 0.5 },
      ],
    };
    const [year0] = projectWith([acct]);
    expect(year0.portfolioAssets.taxableTotal).toBe(500_000);
    expect(year0.portfolioAssets.accessibleTrustAssetsTotal).toBe(500_000);
    expect(year0.portfolioAssets.trustsAndBusinessesTotal).toBe(0);
  });

  it("household-owned business-category account mirrors into trustsAndBusinessesTotal", () => {
    const acct: Account = {
      id: "biz-direct",
      name: "Sole Prop",
      category: "business",
      subType: "operating",
      value: 250_000,
      basis: 0,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const [year0] = projectWith([acct]);
    expect(year0.portfolioAssets.businessTotal).toBe(250_000);
    expect(year0.portfolioAssets.trustsAndBusinessesTotal).toBe(250_000);
  });

  it("grand total reconciles when summing across all buckets", () => {
    const accts: Account[] = [
      {
        id: "a1",
        name: "Brokerage",
        category: "taxable",
        subType: "brokerage",
        value: 100,
        basis: 100,
        growthRate: 0,
        rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
      {
        id: "a2",
        name: "Home",
        category: "real_estate",
        subType: "primary_residence",
        value: 500,
        basis: 500,
        growthRate: 0,
        rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
      {
        id: "a3",
        name: "FLP RE",
        category: "real_estate",
        subType: "investment",
        value: 300,
        basis: 300,
        growthRate: 0,
        rmdEnabled: false,
        owners: [{ kind: "entity", entityId: ENT_NON_IIP_LOCKED, percent: 1 }],
      },
      {
        id: "a4",
        name: "HEMS Cash",
        category: "cash",
        subType: "checking",
        value: 50,
        basis: 50,
        growthRate: 0,
        rmdEnabled: false,
        owners: [{ kind: "entity", entityId: ENT_NON_IIP_ACCESSIBLE, percent: 1 }],
      },
    ];
    const [year0] = projectWith(accts);
    const liquid =
      year0.portfolioAssets.taxableTotal +
      year0.portfolioAssets.cashTotal +
      year0.portfolioAssets.retirementTotal +
      year0.portfolioAssets.lifeInsuranceTotal;
    const grand =
      liquid +
      year0.portfolioAssets.trustsAndBusinessesTotal +
      year0.portfolioAssets.accessibleTrustAssetsTotal +
      year0.portfolioAssets.realEstateTotal;
    expect(grand).toBe(100 + 500 + 300 + 50); // 950
  });
});
