import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type { ClientData, FamilyMember, Gift } from "../types";

const PUBLIC_CHARITY_ID = "00000000-0000-0000-0000-000000000aaa";
const PRIVATE_CHARITY_ID = "00000000-0000-0000-0000-000000000bbb";
const CLIENT_FM_ID = "00000000-0000-0000-0000-000000000001";

function baseScenario(): ClientData {
  return {
    client: {
      firstName: "Charitable",
      lastName: "Test",
      // dateOfBirth replaces birthYear/currentAge (ClientInfo uses DOB strings, not year ints)
      dateOfBirth: "1970-01-01",
      filingStatus: "married_joint",
      retirementAge: 67,
      // planEndAge replaces lifeExpectancy on the ClientInfo shape
      planEndAge: 90,
    },
    accounts: [
      {
        id: "acc-cash",
        name: "Joint Checking",
        category: "cash",
        subType: "checking",
        value: 5_000_000,
        basis: 5_000_000,
        growthRate: 0,
        rmdEnabled: false,
        owners: [
          { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 },
        ],
      } as ClientData["accounts"][number],
    ],
    incomes: [
      {
        id: "inc-salary",
        // annualAmount is the runtime field (not `amount`)
        name: "Salary",
        type: "salary",
        owner: "client",
        annualAmount: 1_000_000,
        growthRate: 0,
        startYear: 2026,
        endYear: 2030,
      } as ClientData["incomes"][number],
    ],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings: {
      flatFederalRate: 0,
      flatStateRate: 0,
      inflationRate: 0,
      planStartYear: 2026,
      planEndYear: 2030,
      taxEngineMode: "bracket",
      taxInflationRate: 0.025,
      estateAdminExpenses: 0,
      flatStateEstateRate: 0,
    },
    entities: [],
    deductions: [],
    transfers: [],
    assetTransactions: [],
    gifts: [],
    // giftEvents is required (not optional) in ClientData
    giftEvents: [],
    wills: [],
    familyMembers: [
      {
        id: CLIENT_FM_ID,
        firstName: "Client",
        lastName: "Test",
        relationship: "other",
        role: "client",
        dateOfBirth: "1970-01-01",
      } as FamilyMember,
    ],
    externalBeneficiaries: [
      { id: PUBLIC_CHARITY_ID, name: "Stanford", kind: "charity", charityType: "public" },
      { id: PRIVATE_CHARITY_ID, name: "Smith Family Foundation", kind: "charity", charityType: "private" },
    ],
  } as ClientData;
}

describe("Charitable deduction — runProjection integration", () => {
  it("$100K cash gift to public charity at 60% AGI limit produces full deduction", () => {
    const data = baseScenario();
    data.gifts = [
      {
        id: "gift-1",
        year: 2026,
        amount: 100_000,
        grantor: "client",
        recipientExternalBeneficiaryId: PUBLIC_CHARITY_ID,
        useCrummeyPowers: false,
      } as Gift,
    ];

    const years = runProjection(data);
    const year2026 = years.find((y) => y.year === 2026);
    expect(year2026).toBeDefined();
    expect(year2026!.charityCarryforward?.cashPublic).toEqual([]);
  });

  it("$800K cash gift to public charity exceeds AGI limit; excess carries forward", () => {
    const data = baseScenario();
    data.gifts = [
      {
        id: "gift-1",
        year: 2026,
        amount: 800_000,
        grantor: "client",
        recipientExternalBeneficiaryId: PUBLIC_CHARITY_ID,
        useCrummeyPowers: false,
      } as Gift,
    ];

    const years = runProjection(data);
    const year2026 = years.find((y) => y.year === 2026);
    expect(year2026!.charityCarryforward?.cashPublic).toEqual([
      { amount: 200_000, originYear: 2026 },
    ]);

    const year2027 = years.find((y) => y.year === 2027);
    expect(year2027!.charityCarryforward?.cashPublic).toEqual([]);
  });

  it("private charity gift uses 30% bucket", () => {
    const data = baseScenario();
    data.gifts = [
      {
        id: "gift-1",
        year: 2026,
        amount: 400_000,
        grantor: "client",
        recipientExternalBeneficiaryId: PRIVATE_CHARITY_ID,
        useCrummeyPowers: false,
      } as Gift,
    ];

    const years = runProjection(data);
    const year2026 = years.find((y) => y.year === 2026);
    expect(year2026!.charityCarryforward?.cashPrivate).toEqual([
      { amount: 100_000, originYear: 2026 },
    ]);
  });

  it("no charitable gifts — carryforward stays empty", () => {
    const data = baseScenario();
    const years = runProjection(data);
    const year2026 = years.find((y) => y.year === 2026);
    expect(year2026!.charityCarryforward).toBeDefined();
    expect(year2026!.charityCarryforward!.cashPublic).toEqual([]);
    expect(year2026!.charityCarryforward!.cashPrivate).toEqual([]);
    expect(year2026!.charityCarryforward!.appreciatedPublic).toEqual([]);
    expect(year2026!.charityCarryforward!.appreciatedPrivate).toEqual([]);
  });
});
