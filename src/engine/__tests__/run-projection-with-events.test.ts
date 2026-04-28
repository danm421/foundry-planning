import { describe, it, expect } from "vitest";
import { runProjectionWithEvents } from "../projection";
import type {
  Account,
  ClientData,
  ClientInfo,
  FamilyMember,
  PlanSettings,
  Will,
} from "../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

// ── Shared scaffolding ───────────────────────────────────────────────────────

const defaultClientFm: FamilyMember = {
  id: LEGACY_FM_CLIENT, role: "client", relationship: "other",
  firstName: "Client", lastName: "Test", dateOfBirth: "1970-01-01",
};
const defaultSpouseFm: FamilyMember = {
  id: LEGACY_FM_SPOUSE, role: "spouse", relationship: "other",
  firstName: "Spouse", lastName: "Test", dateOfBirth: "1972-01-01",
};
const kidA: FamilyMember = {
  id: "kid-a", role: "child", relationship: "child",
  firstName: "Alice", lastName: "Test", dateOfBirth: "2000-01-01",
};

const basePlanSettings: PlanSettings = {
  flatFederalRate: 0,
  flatStateRate: 0,
  inflationRate: 0.025,
  planStartYear: 2026,
  planEndYear: 2066,
  taxInflationRate: 0.025,
  estateAdminExpenses: 0,
  flatStateEstateRate: 0,
};

/** Minimal accounts: client-only brokerage + spouse-only cash. */
const accounts: Account[] = [
  {
    id: "client-brok", name: "Client Brokerage",
    category: "taxable", subType: "brokerage",
    value: 1_000_000, basis: 700_000,
    growthRate: 0, rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  },
  {
    id: "spouse-cash", name: "Spouse Cash",
    category: "cash", subType: "savings",
    value: 500_000, basis: 500_000,
    growthRate: 0, rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }],
  },
];

/** Wills routing everything to the surviving spouse at first death, then to
 *  kid-a at final death. */
const wills: Will[] = [
  {
    id: "w-client", grantor: "client",
    bequests: [{
      id: "beq-c", name: "All to spouse",
      kind: "asset", assetMode: "all_assets", accountId: null, liabilityId: null,
      percentage: 100, condition: "always", sortOrder: 0,
      recipients: [{ recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 }],
    }],
  },
  {
    id: "w-spouse", grantor: "spouse",
    bequests: [{
      id: "beq-s", name: "All to kid",
      kind: "asset", assetMode: "all_assets", accountId: null, liabilityId: null,
      percentage: 100, condition: "always", sortOrder: 0,
      recipients: [{ recipientKind: "family_member", recipientId: "kid-a", percentage: 100, sortOrder: 0 }],
    }],
  },
];

// ── Tests ────────────────────────────────────────────────────────────────────

describe("runProjectionWithEvents", () => {
  it("returns years[] plus firstDeathEvent and secondDeathEvent for a two-grantor projection", () => {
    // Client born 1970 + lifeExpectancy 75 → dies 2045 (first death, deathOrder 1).
    // Spouse born 1972 + lifeExpectancy 80 → dies 2052 (final death, deathOrder 2).
    const client: ClientInfo = {
      firstName: "John", lastName: "Smith",
      dateOfBirth: "1970-01-01",
      retirementAge: 65, planEndAge: 95,
      filingStatus: "married_joint",
      lifeExpectancy: 75,
      spouseDob: "1972-01-01",
      spouseLifeExpectancy: 80,
    };

    const data: ClientData = {
      client,
      accounts,
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: basePlanSettings,
      familyMembers: [defaultClientFm, defaultSpouseFm, kidA],
      wills,
      giftEvents: [],
    };

    const result = runProjectionWithEvents(data);

    expect(result.years.length).toBeGreaterThan(0);

    // Both death events must be present.
    expect(result.firstDeathEvent).toBeDefined();
    expect(result.secondDeathEvent).toBeDefined();

    // First death: client dies in 2045.
    expect(result.firstDeathEvent!.year).toBe(2045);
    expect(result.firstDeathEvent!.deathOrder).toBe(1);
    expect(result.firstDeathEvent!.deceased).toBe("client");

    // Second death: spouse dies in 2052.
    expect(result.secondDeathEvent!.year).toBe(2052);
    expect(result.secondDeathEvent!.deathOrder).toBe(2);
    expect(result.secondDeathEvent!.deceased).toBe("spouse");

    // Spot-check that the refs are the same objects as in years[].
    const firstYr = result.years.find((y) => y.year === 2045);
    const secondYr = result.years.find((y) => y.year === 2052);
    expect(result.firstDeathEvent).toBe(firstYr!.estateTax);
    expect(result.secondDeathEvent).toBe(secondYr!.estateTax);
  });

  it("returns undefined event refs when no death year falls inside the projection window", () => {
    // Both grantors have no lifeExpectancy set → computeFirstDeathYear returns
    // null → projection emits no death-event years.
    const client: ClientInfo = {
      firstName: "John", lastName: "Smith",
      dateOfBirth: "1970-01-01",
      retirementAge: 65, planEndAge: 90,
      filingStatus: "married_joint",
      // lifeExpectancy intentionally omitted
      spouseDob: "1972-01-01",
      // spouseLifeExpectancy intentionally omitted
    };

    const data: ClientData = {
      client,
      accounts,
      incomes: [],
      expenses: [],
      liabilities: [],
      savingsRules: [],
      withdrawalStrategy: [],
      planSettings: basePlanSettings,
      familyMembers: [defaultClientFm, defaultSpouseFm],
      giftEvents: [],
    };

    const result = runProjectionWithEvents(data);

    expect(result.years.length).toBeGreaterThan(0);
    expect(result.firstDeathEvent).toBeUndefined();
    expect(result.secondDeathEvent).toBeUndefined();
  });
});
