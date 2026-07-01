import type {
  Account,
  ClientData,
  ClientInfo,
  FamilyMember,
  PlanSettings,
  Will,
} from "../../types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../../ownership";

// A married household whose two deaths land in DIFFERENT years inside the plan
// window, with value routed to a non-spouse heir at the survivor's death:
//   client born 1970 + lifeExpectancy 75 → dies 2045 (first death, deathOrder 1)
//   spouse born 1972 + lifeExpectancy 80 → dies 2052 (final death, deathOrder 2)
// First death passes everything to the surviving spouse (marital deduction);
// the survivor's will routes the whole estate to kid-a, so heirs receive value
// only at the second death. Modeled on the inline fixture in
// run-projection-with-events.test.ts. Exported so the anchored-hypothetical and
// downstream reconciliation tasks share one canonical married-estate fixture.

const clientFm: FamilyMember = {
  id: LEGACY_FM_CLIENT,
  role: "client",
  relationship: "other",
  firstName: "Client",
  lastName: "Test",
  dateOfBirth: "1970-01-01",
};

const spouseFm: FamilyMember = {
  id: LEGACY_FM_SPOUSE,
  role: "spouse",
  relationship: "other",
  firstName: "Spouse",
  lastName: "Test",
  dateOfBirth: "1972-01-01",
};

const kidA: FamilyMember = {
  id: "kid-a",
  role: "child",
  relationship: "child",
  firstName: "Alice",
  lastName: "Test",
  dateOfBirth: "2000-01-01",
};

const planSettings: PlanSettings = {
  flatFederalRate: 0,
  flatStateRate: 0,
  inflationRate: 0.025,
  planStartYear: 2026,
  planEndYear: 2066,
  taxInflationRate: 0.025,
  estateAdminExpenses: 25_000,
  flatStateEstateRate: 0,
};

const accounts: Account[] = [
  {
    id: "client-brok",
    name: "Client Brokerage",
    category: "taxable",
    subType: "brokerage",
    titlingType: "jtwros",
    value: 15_000_000,
    basis: 10_000_000,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  },
  {
    id: "spouse-cash",
    name: "Spouse Cash",
    category: "cash",
    subType: "savings",
    titlingType: "jtwros",
    value: 500_000,
    basis: 500_000,
    growthRate: 0,
    rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }],
  },
];

// Everything to the surviving spouse at first death, then to kid-a at final death.
const wills: Will[] = [
  {
    id: "w-client",
    grantor: "client",
    bequests: [
      {
        id: "beq-c",
        name: "All to spouse",
        kind: "asset",
        assetMode: "all_assets",
        accountId: null,
        liabilityId: null,
        entityId: null,
        percentage: 100,
        condition: "always",
        sortOrder: 0,
        recipients: [{ recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 }],
      },
    ],
  },
  {
    id: "w-spouse",
    grantor: "spouse",
    bequests: [
      {
        id: "beq-s",
        name: "All to kid",
        kind: "asset",
        assetMode: "all_assets",
        accountId: null,
        liabilityId: null,
        entityId: null,
        percentage: 100,
        condition: "always",
        sortOrder: 0,
        recipients: [
          { recipientKind: "family_member", recipientId: "kid-a", percentage: 100, sortOrder: 0 },
        ],
      },
    ],
  },
];

/**
 * Builds a married-with-estate {@link ClientData} whose first and second deaths
 * land in distinct years (2045 client, 2052 spouse) inside the plan window,
 * with the whole estate routed to a non-spouse heir (kid-a) at the survivor's
 * death. Returns a fresh object each call so tests can mutate freely.
 */
export function buildMarriedEstateFixture(): ClientData {
  const client: ClientInfo = {
    firstName: "John",
    lastName: "Smith",
    dateOfBirth: "1970-01-01",
    retirementAge: 65,
    planEndAge: 95,
    filingStatus: "married_joint",
    lifeExpectancy: 75,
    spouseDob: "1972-01-01",
    spouseLifeExpectancy: 80,
  };

  return {
    client,
    accounts: structuredClone(accounts),
    incomes: [],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: { ...planSettings },
    familyMembers: [clientFm, spouseFm, kidA],
    wills: structuredClone(wills),
    giftEvents: [],
  };
}
