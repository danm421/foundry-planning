import { describe, it, expect } from "vitest";
import { computeHypotheticalEstateTax } from "../hypothetical-estate-tax";
import type {
  Account,
  EntitySummary,
  FamilyMember,
  Gift,
  Income,
  Liability,
  PlanSettings,
  Will,
} from "../../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../../ownership";

const principalFamilyMembers: FamilyMember[] = [
  {
    id: LEGACY_FM_CLIENT,
    role: "client",
    relationship: "other",
    firstName: "Client",
    lastName: null,
    dateOfBirth: "1965-01-01",
  },
  {
    id: LEGACY_FM_SPOUSE,
    role: "spouse",
    relationship: "other",
    firstName: "Spouse",
    lastName: null,
    dateOfBirth: "1967-01-01",
  },
];

function makeAccount(
  id: string,
  owner: "client" | "spouse" | "joint",
  value: number,
): Account {
  let owners: Account["owners"];
  if (owner === "client") {
    owners = [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }];
  } else if (owner === "spouse") {
    owners = [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }];
  } else {
    owners = [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
      { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
    ];
  }
  return {
    id,
    name: id,
    category: "taxable",
    subType: "brokerage",
    value,
    basis: value,
    growthRate: 0,
    rmdEnabled: false,
    owners,
  } as unknown as Account;
}

function basePlanSettings(): PlanSettings {
  return {
    planStartYear: 2026,
    planEndYear: 2070,
    estateAdminExpenses: 0,
    flatStateEstateRate: 0,
  } as unknown as PlanSettings;
}

describe("computeHypotheticalEstateTax", () => {
  it("married: primary-first returns first+final death results with DSUE handoff", () => {
    const accounts = [
      makeAccount("client-401k", "client", 5_000_000),
      makeAccount("spouse-401k", "spouse", 3_000_000),
      makeAccount("joint-brokerage", "joint", 2_000_000),
    ];
    const accountBalances: Record<string, number> = {
      "client-401k": 5_000_000,
      "spouse-401k": 3_000_000,
      "joint-brokerage": 2_000_000,
    };
    const basisMap: Record<string, number> = {
      "client-401k": 5_000_000,
      "spouse-401k": 3_000_000,
      "joint-brokerage": 2_000_000,
    };

    const result = computeHypotheticalEstateTax({
      year: 2030,
      isMarried: true,
      accounts,
      accountBalances,
      basisMap,
      incomes: [] as Income[],
      liabilities: [] as Liability[],
      familyMembers: principalFamilyMembers,
      externalBeneficiaries: [],
      entities: [] as EntitySummary[],
      wills: [] as Will[],
      planSettings: basePlanSettings(),
      gifts: [] as Gift[],
      annualExclusionsByYear: {},
    });

    expect(result.year).toBe(2030);
    expect(result.primaryFirst.firstDecedent).toBe("client");
    expect(result.primaryFirst.firstDeath.deceased).toBe("client");
    expect(result.primaryFirst.finalDeath).toBeDefined();
    expect(result.primaryFirst.finalDeath!.deceased).toBe("spouse");

    // Under BEA (2030 still has sunset BEA around $7M/person), small
    // estate → federal tax zero for both deaths; totals == admin+state (0).
    expect(result.primaryFirst.totals.federal).toBeGreaterThanOrEqual(0);
    expect(result.primaryFirst.totals.total).toBe(
      result.primaryFirst.firstDeath.totalTaxesAndExpenses +
        result.primaryFirst.finalDeath!.totalTaxesAndExpenses,
    );

    // DSUE handoff: the survivor's death should receive non-zero DSUE
    // whenever first-death generated DSUE (marital-deduction path).
    expect(result.primaryFirst.firstDeath.dsueGenerated).toBeGreaterThan(0);
    expect(result.primaryFirst.finalDeath!.dsueReceived).toBe(
      result.primaryFirst.firstDeath.dsueGenerated,
    );
  });

  it("married: spouseFirst mirrors primaryFirst with decedent/survivor swapped", () => {
    const accounts = [
      makeAccount("client-401k", "client", 5_000_000),
      makeAccount("spouse-401k", "spouse", 3_000_000),
      makeAccount("joint-brokerage", "joint", 2_000_000),
    ];
    const accountBalances: Record<string, number> = {
      "client-401k": 5_000_000,
      "spouse-401k": 3_000_000,
      "joint-brokerage": 2_000_000,
    };
    const basisMap: Record<string, number> = {
      "client-401k": 5_000_000,
      "spouse-401k": 3_000_000,
      "joint-brokerage": 2_000_000,
    };

    const result = computeHypotheticalEstateTax({
      year: 2030,
      isMarried: true,
      accounts,
      accountBalances,
      basisMap,
      incomes: [] as Income[],
      liabilities: [] as Liability[],
      familyMembers: principalFamilyMembers,
      externalBeneficiaries: [],
      entities: [] as EntitySummary[],
      wills: [] as Will[],
      planSettings: basePlanSettings(),
      gifts: [] as Gift[],
      annualExclusionsByYear: {},
    });

    expect(result.spouseFirst).toBeDefined();
    expect(result.spouseFirst!.firstDecedent).toBe("spouse");
    expect(result.spouseFirst!.firstDeath.deceased).toBe("spouse");
    expect(result.spouseFirst!.finalDeath).toBeDefined();
    expect(result.spouseFirst!.finalDeath!.deceased).toBe("client");
    expect(result.spouseFirst!.firstDeath.dsueGenerated).toBeGreaterThan(0);
    expect(result.spouseFirst!.finalDeath!.dsueReceived).toBe(
      result.spouseFirst!.firstDeath.dsueGenerated,
    );
  });

  it("threads entityAccountSharesEoY so a business's slice of a drained split-owned account isn't understated", () => {
    // Savings account split 80% client / 20% an LLC the client owns 100%.
    // The household drew its cash shortfall down to a $50k year-end balance.
    // The business's locked EoY share — protected from household flows — is
    // still $20k. Without the locked share threaded through, the business
    // gross-estate line falls back to drainedBalance × 20% = $10k, netting
    // the household's liquidation against the business's own cash.
    const savings: Account = {
      id: "savings",
      name: "Savings Account",
      category: "cash",
      subType: "savings",
      value: 50_000,
      basis: 50_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [
        { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.8 },
        { kind: "entity", entityId: "biz", percent: 0.2 },
      ],
    } as unknown as Account;

    const business: EntitySummary = {
      id: "biz",
      name: "Test Bus",
      includeInPortfolio: true,
      isGrantor: false,
      entityType: "llc",
      value: 0,
      owners: [{ familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    } as unknown as EntitySummary;

    const result = computeHypotheticalEstateTax({
      year: 2030,
      isMarried: false,
      accounts: [savings],
      accountBalances: { savings: 50_000 },
      basisMap: { savings: 50_000 },
      incomes: [] as Income[],
      liabilities: [] as Liability[],
      familyMembers: principalFamilyMembers,
      externalBeneficiaries: [],
      entities: [business],
      wills: [] as Will[],
      planSettings: basePlanSettings(),
      gifts: [] as Gift[],
      annualExclusionsByYear: {},
      // Business's locked share of the savings account: $20k, untouched by
      // the household's drawdown that took the account balance to $50k.
      entityAccountSharesEoY: new Map([["biz", new Map([["savings", 20_000]])]]),
    });

    const businessLine = result.primaryFirst.firstDeath.grossEstateLines?.find(
      (l) => l.entityId === "biz",
    );
    expect(businessLine).toBeDefined();
    expect(businessLine!.amount).toBeCloseTo(20_000, 2);
  });

  it("single: only primaryFirst populated; no finalDeath; totals reflect one death", () => {
    const accounts = [makeAccount("client-401k", "client", 5_000_000)];
    const accountBalances: Record<string, number> = {
      "client-401k": 5_000_000,
    };
    const basisMap: Record<string, number> = { "client-401k": 5_000_000 };

    const result = computeHypotheticalEstateTax({
      year: 2030,
      isMarried: false,
      accounts,
      accountBalances,
      basisMap,
      incomes: [] as Income[],
      liabilities: [] as Liability[],
      familyMembers: principalFamilyMembers,
      externalBeneficiaries: [],
      entities: [] as EntitySummary[],
      wills: [] as Will[],
      planSettings: basePlanSettings(),
      gifts: [] as Gift[],
      annualExclusionsByYear: {},
    });

    expect(result.primaryFirst.firstDecedent).toBe("client");
    expect(result.primaryFirst.finalDeath).toBeUndefined();
    expect(result.spouseFirst).toBeUndefined();
    expect(result.primaryFirst.totals.total).toBe(
      result.primaryFirst.firstDeath.totalTaxesAndExpenses,
    );
  });
});
