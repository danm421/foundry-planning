import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, baseClient } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, EntitySummary, Expense, FamilyMember, WithdrawalPriority } from "../types";

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

// ── Mixed ownership + household withdrawal ───────────────────────────────────
// Bug: cash-flow drilldown shows portfolioAssets[acctId] = postWithdrawalBalance × ownerPercent,
// which proportionally reduces BOTH the household and entity shares when only the
// household actually drew. The balance sheet uses the engine's locked entity-share
// (entityAccountSharesEoY) which leaves the entity's share untouched. The drilldown
// must agree with the balance sheet's accounting.

describe("portfolioAssets — mixed ownership preserves entity share through household withdrawals", () => {
  const soloClient: FamilyMember[] = [
    {
      id: LEGACY_FM_CLIENT,
      role: "client",
      relationship: "other",
      firstName: "Solo",
      lastName: "Test",
      dateOfBirth: "1960-01-01", // age 66 in 2026 — avoids early-withdrawal penalty noise
    },
  ];

  it("a household-side withdrawal from a 70/30 (HH/non-IIP-trust) account reduces only the household portfolio share", () => {
    const checking: Account = {
      id: "acct-checking",
      name: "Checking",
      category: "cash",
      subType: "checking",
      value: 1000,
      basis: 1000,
      growthRate: 0,
      rmdEnabled: false,
      isDefaultChecking: true,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    // 70% household / 30% non-IIP locked SLAT — entity slice should never drop
    // because of household activity on this account.
    const mixed: Account = {
      id: "acct-mixed",
      name: "Joint+SLAT Brokerage",
      category: "taxable",
      subType: "brokerage",
      value: 1_000_000,
      basis: 1_000_000,
      growthRate: 0, // keeps math clean — no growth, no income
      rmdEnabled: false,
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.7 },
        { kind: "entity", entityId: ENT_NON_IIP_LOCKED, percent: 0.3 },
      ],
    };
    const livingExpense: Expense = {
      id: "exp-living",
      name: "Living",
      type: "living",
      annualAmount: 80_000,
      growthRate: 0,
      startYear: 2026,
      endYear: 2026,
    };
    const strategy: WithdrawalPriority[] = [
      { accountId: "acct-mixed", priorityOrder: 1, startYear: 2026, endYear: 2026 },
    ];

    const data = buildClientData({
      client: { ...baseClient, dateOfBirth: "1960-01-01", spouseDob: undefined },
      familyMembers: soloClient,
      accounts: [checking, mixed],
      entities,
      incomes: [],
      expenses: [livingExpense],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: strategy,
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const [year0] = runProjection(data);

    // Sanity: the engine actually pulled from the mixed account.
    const draw = year0.withdrawals.byAccount["acct-mixed"] ?? 0;
    expect(draw).toBeGreaterThan(0);

    // Balance-sheet truth: entity locked EoY = beginningValue × percent (no growth).
    const entityLocked =
      year0.entityAccountSharesEoY?.get(ENT_NON_IIP_LOCKED)?.get("acct-mixed") ?? 0;
    expect(entityLocked).toBeCloseTo(300_000, 6);

    // The drilldown's per-account entity bucket must match the locked share —
    // i.e. the entity is unaffected by the household withdrawal.
    const drillEntity = year0.portfolioAssets.trustsAndBusinesses["acct-mixed"] ?? 0;
    expect(drillEntity).toBeCloseTo(entityLocked, 6);

    // The household side equals the family pool: ledger.endingValue − entityLocked.
    const ledger = year0.accountLedgers["acct-mixed"];
    expect(ledger).toBeDefined();
    const familyPool = ledger.endingValue - entityLocked;
    const drillFamily = year0.portfolioAssets.taxable["acct-mixed"] ?? 0;
    expect(drillFamily).toBeCloseTo(familyPool, 6);
  });

  it("the same 70/30 split account routes the entity slice to accessibleTrustAssets when the trust is accessible", () => {
    const checking: Account = {
      id: "acct-checking",
      name: "Checking",
      category: "cash",
      subType: "checking",
      value: 1000,
      basis: 1000,
      growthRate: 0,
      rmdEnabled: false,
      isDefaultChecking: true,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const mixed: Account = {
      id: "acct-mixed-acc",
      name: "Joint+HEMS Brokerage",
      category: "taxable",
      subType: "brokerage",
      value: 1_000_000,
      basis: 1_000_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.7 },
        { kind: "entity", entityId: ENT_NON_IIP_ACCESSIBLE, percent: 0.3 },
      ],
    };
    const livingExpense: Expense = {
      id: "exp-living",
      name: "Living",
      type: "living",
      annualAmount: 80_000,
      growthRate: 0,
      startYear: 2026,
      endYear: 2026,
    };
    const strategy: WithdrawalPriority[] = [
      { accountId: "acct-mixed-acc", priorityOrder: 1, startYear: 2026, endYear: 2026 },
    ];

    const data = buildClientData({
      client: { ...baseClient, dateOfBirth: "1960-01-01", spouseDob: undefined },
      familyMembers: soloClient,
      accounts: [checking, mixed],
      entities,
      incomes: [],
      expenses: [livingExpense],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: strategy,
      planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear: 2026 },
    });
    const [year0] = runProjection(data);

    const draw = year0.withdrawals.byAccount["acct-mixed-acc"] ?? 0;
    expect(draw).toBeGreaterThan(0);

    const entityLocked =
      year0.entityAccountSharesEoY?.get(ENT_NON_IIP_ACCESSIBLE)?.get("acct-mixed-acc") ?? 0;
    expect(entityLocked).toBeCloseTo(300_000, 6);

    // Accessible trust slice in the drilldown matches the locked share.
    const drillEntity = year0.portfolioAssets.accessibleTrustAssets["acct-mixed-acc"] ?? 0;
    expect(drillEntity).toBeCloseTo(entityLocked, 6);

    // No leak into trustsAndBusinesses for an accessible-trust slice.
    expect(year0.portfolioAssets.trustsAndBusinesses["acct-mixed-acc"] ?? 0).toBe(0);
  });
});
