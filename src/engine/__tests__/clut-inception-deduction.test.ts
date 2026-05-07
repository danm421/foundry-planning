import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type { ClientData, FamilyMember } from "../types";

const PUBLIC_CHARITY_ID = "00000000-0000-0000-0000-000000000aaa";
const CLIENT_FM_ID = "00000000-0000-0000-0000-000000000001";
const CLUT_ENTITY_ID = "00000000-0000-0000-0000-000000000ccc";

function baseScenarioWithClut(opts: {
  inceptionYear: number;
  originalIncomeInterest: number;
  originalRemainderInterest: number;
  agi?: number;
}): ClientData {
  return {
    client: {
      firstName: "Charitable",
      lastName: "Test",
      dateOfBirth: "1970-01-01",
      filingStatus: "married_joint",
      retirementAge: 67,
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
        name: "Salary",
        type: "salary",
        owner: "client",
        annualAmount: opts.agi ?? 1_000_000,
        growthRate: 0,
        startYear: opts.inceptionYear,
        endYear: opts.inceptionYear + 5,
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
      planStartYear: opts.inceptionYear,
      planEndYear: opts.inceptionYear + 5,
      taxEngineMode: "bracket",
      taxInflationRate: 0.025,
      estateAdminExpenses: 0,
      flatStateEstateRate: 0,
    },
    entities: [
      {
        id: CLUT_ENTITY_ID,
        name: "Smith Family CLUT",
        entityType: "trust",
        trustSubType: "clut",
        isIrrevocable: true,
        isGrantor: true,
        includeInPortfolio: false,
        grantor: "client",
        splitInterest: {
          inceptionYear: opts.inceptionYear,
          inceptionValue: opts.originalIncomeInterest + opts.originalRemainderInterest,
          payoutType: "unitrust",
          payoutPercent: 0.06,
          payoutAmount: null,
          irc7520Rate: 0.022,
          termType: "years",
          termYears: 10,
          measuringLife1Id: null,
          measuringLife2Id: null,
          charityId: PUBLIC_CHARITY_ID,
          originalIncomeInterest: opts.originalIncomeInterest,
          originalRemainderInterest: opts.originalRemainderInterest,
        },
      },
    ],
    deductions: [],
    transfers: [],
    assetTransactions: [],
    gifts: [],
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
      { id: PUBLIC_CHARITY_ID, name: "Acme Foundation", kind: "charity", charityType: "public" },
    ],
  } as ClientData;
}

describe("CLUT inception charitable deduction", () => {
  it("emits the income-interest as a 30%-AGI charitable contribution in the funding year (public charity)", () => {
    const data = baseScenarioWithClut({
      inceptionYear: 2026,
      originalIncomeInterest: 461_385,
      originalRemainderInterest: 538_615,
      agi: 5_000_000, // very high AGI: $1.5M cap >> $461K, full deduction
    });
    const years = runProjection(data);
    const funding = years.find((y) => y.year === 2026)!;
    // The CLUT inception income-interest routes into the appreciatedPublic
    // bucket. With high AGI ($5M) the full $461K fits within the 30% cap so
    // nothing carries forward.
    expect(funding.charityCarryforward?.appreciatedPublic).toEqual([]);
    expect(funding.charityCarryforward?.appreciatedPrivate).toEqual([]);
  });

  it("respects 30% AGI cap and carries forward unused deduction (low AGI)", () => {
    // 30% × $200K AGI = $60K cap; $461K income interest → ~$401K carryforward
    const data = baseScenarioWithClut({
      inceptionYear: 2026,
      originalIncomeInterest: 461_385,
      originalRemainderInterest: 538_615,
      agi: 200_000,
    });
    const years = runProjection(data);
    const funding = years.find((y) => y.year === 2026)!;
    // Excess of income interest over 30%-AGI cap should sit in the
    // appreciatedPublic carryforward bucket.
    expect(funding.charityCarryforward?.appreciatedPublic.length ?? 0).toBeGreaterThan(0);
    const totalCf = (funding.charityCarryforward?.appreciatedPublic ?? [])
      .reduce((s, lot) => s + lot.amount, 0);
    expect(totalCf).toBeGreaterThan(300_000);
  });

  it("does not re-emit the deduction in subsequent years", () => {
    const data = baseScenarioWithClut({
      inceptionYear: 2026,
      originalIncomeInterest: 461_385,
      originalRemainderInterest: 538_615,
      agi: 5_000_000,
    });
    const years = runProjection(data);
    // 2027 should not see a fresh appreciatedPublic deposit (only carryforwards
    // from 2026 if any). With $5M AGI no carryforward exists, so empty.
    const y2027 = years.find((y) => y.year === 2027)!;
    expect(y2027.charityCarryforward?.appreciatedPublic).toEqual([]);
  });
});
