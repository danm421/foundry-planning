import { describe, it, expect } from "vitest";
import type { AccountOwner } from "@/engine/ownership";
import { runProjectionWithEvents } from "@/engine/projection";
import { buildClientData, baseClient, basePlanSettings } from "@/engine/__tests__/fixtures";
import type { Account, FamilyMember } from "@/engine/types";
import { fillHouseholdCashOwners } from "../household-cash-owners";

// Real family-member ids, as the loader reads them. The engine fixtures use the
// legacy sentinel ids AS their family-member ids, which is why no existing test
// saw an ownerless Household Cash fall out of the estate.
const CLIENT_FM = "0b6f1c1e-client";
const SPOUSE_FM = "7d2a9e44-spouse";
const married = [
  { id: CLIENT_FM, role: "client" },
  { id: SPOUSE_FM, role: "spouse" },
];

function row(id: string, over: Partial<{ isDefaultChecking: boolean; parentAccountId: string | null }> = {}) {
  return { id, isDefaultChecking: true, parentAccountId: null, ...over };
}

describe("fillHouseholdCashOwners", () => {
  it("makes an ownerless Household Cash joint between the client and spouse", () => {
    const owners = new Map<string, AccountOwner[]>();
    fillHouseholdCashOwners([row("cash")], owners, married);
    expect(owners.get("cash")).toEqual([
      { kind: "family_member", familyMemberId: CLIENT_FM, percent: 0.5 },
      { kind: "family_member", familyMemberId: SPOUSE_FM, percent: 0.5 },
    ]);
  });

  it("gives a single client's Household Cash to the client", () => {
    const owners = new Map<string, AccountOwner[]>();
    fillHouseholdCashOwners([row("cash")], owners, [{ id: CLIENT_FM, role: "client" }]);
    expect(owners.get("cash")).toEqual([{ kind: "family_member", familyMemberId: CLIENT_FM, percent: 1 }]);
  });

  it("leaves owner rows that exist, a business's own cash, and other accounts alone", () => {
    const entityCash: AccountOwner[] = [{ kind: "entity", entityId: "trust-1", percent: 1 }];
    const owners = new Map<string, AccountOwner[]>([["trust-cash", entityCash]]);
    fillHouseholdCashOwners(
      [
        row("trust-cash"),
        row("business-cash", { parentAccountId: "biz-1" }),
        row("brokerage", { isDefaultChecking: false }),
      ],
      owners,
      married,
    );
    expect(owners.get("trust-cash")).toBe(entityCash);
    expect(owners.has("business-cash")).toBe(false);
    expect(owners.has("brokerage")).toBe(false);
  });

  it("does nothing without a client family member", () => {
    const owners = new Map<string, AccountOwner[]>();
    fillHouseholdCashOwners([row("cash")], owners, [{ id: "kid", role: "child" }]);
    expect(owners.has("cash")).toBe(false);
  });
});

describe("Household Cash at death", () => {
  const CLIENT_DEATH = 2040; // born 1960 + LE 80
  const SPOUSE_DEATH = 2047; // born 1962 + LE 85
  const familyMembers: FamilyMember[] = [
    { id: CLIENT_FM, role: "client", relationship: "other", firstName: "John", lastName: "Smith", dateOfBirth: "1960-06-01" },
    { id: SPOUSE_FM, role: "spouse", relationship: "other", firstName: "Jane", lastName: "Smith", dateOfBirth: "1962-06-01" },
  ];

  function project() {
    const owners = new Map<string, AccountOwner[]>();
    fillHouseholdCashOwners([row("household-cash")], owners, familyMembers);
    const cash: Account = {
      id: "household-cash",
      name: "Household Cash",
      category: "cash",
      subType: "checking",
      titlingType: "jtwros",
      value: 400_000,
      basis: 400_000,
      growthRate: 0,
      rmdEnabled: false,
      isDefaultChecking: true,
      owners: owners.get("household-cash") ?? [],
    };
    return runProjectionWithEvents(
      buildClientData({
        client: { ...baseClient, dateOfBirth: "1960-06-01", lifeExpectancy: 80, spouseDob: "1962-06-01", spouseLifeExpectancy: 85 },
        familyMembers,
        accounts: [cash],
        incomes: [],
        expenses: [],
        liabilities: [],
        savingsRules: [],
        withdrawalStrategy: [],
        planSettings: { ...basePlanSettings, flatFederalRate: 0, flatStateRate: 0, planStartYear: 2026, planEndYear: SPOUSE_DEATH },
      }),
    );
  }

  it("counts half at the first death and all of it at the second", () => {
    const result = project();
    const first = result.firstDeathEvent!;
    const second = result.secondDeathEvent!;
    expect(first.year).toBe(CLIENT_DEATH);
    expect(second.year).toBe(SPOUSE_DEATH);
    const cashLine = (lines: typeof first.grossEstateLines) => lines.find((l) => l.accountId === "household-cash");
    expect(cashLine(first.grossEstateLines)?.amount).toBeCloseTo(200_000, 0);
    expect(cashLine(second.grossEstateLines)?.amount).toBeCloseTo(400_000, 0);
  });
});
