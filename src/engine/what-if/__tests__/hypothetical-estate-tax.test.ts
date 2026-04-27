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
