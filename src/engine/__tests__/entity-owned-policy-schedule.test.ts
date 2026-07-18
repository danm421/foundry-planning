/**
 * Audit F12 — an ILIT-owned life policy in `scheduled` premium mode must pay
 * the scheduled premium from the trust's own checking.
 *
 * The synthesizers set `annualAmount: 0` and put the real amounts in
 * `scheduleOverrides` (premium-expense.ts:40). Entity-owned rows are resolved
 * by `resolveEntityFlowAmount`, which ignored per-row schedules before F12 —
 * so the ILIT silently paid nothing at all.
 *
 * No existing fixture reaches this shape: prod has no entity-owned policies and
 * no policy anywhere uses `scheduled` mode.
 */
import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { withSynthesizedPremiums } from "@/lib/insurance-policies/premium-expense";
import type { Account, ClientData } from "../types";
import { LEGACY_FM_CLIENT } from "../ownership";

const ILIT_ID = "00000000-0000-0000-0000-0000000005a1";
const ILIT_CHECKING_ID = "00000000-0000-0000-0000-0000000005a2";
const POLICY_ACCOUNT_ID = "00000000-0000-0000-0000-0000000005a3";
const HOUSEHOLD_CHECKING_ID = "00000000-0000-0000-0000-0000000005a4";

const PREMIUM_2026 = 40_000;
const PREMIUM_2027 = 60_000; // deliberately different — a flat fallback can't fake it
const ILIT_STARTING_CASH = 500_000;

function buildIlitPolicyFixture(): ClientData {
  const policyAccount = {
    id: POLICY_ACCOUNT_ID,
    name: "ILIT Whole Life",
    category: "life_insurance",
    subType: "whole_life",
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
    insuredPerson: "client",
    owners: [{ kind: "entity", entityId: ILIT_ID, percent: 1 }],
    lifeInsurance: {
      faceValue: 2_000_000,
      costBasis: 0,
      // Inert in scheduled mode — premiumAmount/premiumYears drive the
      // non-scheduled (flat/level) premium path; here cashValueSchedule below
      // is the real source of truth. Left at 0/null on purpose, not an
      // oversight.
      premiumAmount: 0,
      premiumYears: null,
      premiumPayer: "owner",
      policyType: "whole",
      termIssueYear: null,
      termLengthYears: null,
      endsAtInsuredRetirement: false,
      cashValueGrowthMode: "basic",
      premiumScheduleMode: "scheduled",
      deathBenefitScheduleMode: "off",
      incomeScheduleMode: "off",
      postPayoutGrowthRate: 0,
      cashValueSchedule: [
        { year: 2026, premiumAmount: PREMIUM_2026, deathBenefit: 2_000_000 },
        { year: 2027, premiumAmount: PREMIUM_2027, deathBenefit: 2_000_000 },
      ],
    },
  } as unknown as Account;

  return {
    client: {
      dateOfBirth: "1980-01-01",
      retirementAge: 65,
      filingStatus: "single",
      state: "PA",
      familyMembers: [
        { id: LEGACY_FM_CLIENT, role: "client", dateOfBirth: "1980-01-01" },
      ],
    },
    accounts: [
      {
        id: HOUSEHOLD_CHECKING_ID,
        name: "Personal Checking",
        category: "cash",
        subType: "checking",
        value: 200_000,
        basis: 200_000,
        growthRate: 0,
        rmdEnabled: false,
        owners: [
          { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 },
        ],
      },
      {
        id: ILIT_CHECKING_ID,
        name: "ILIT Checking",
        category: "cash",
        subType: "checking",
        value: ILIT_STARTING_CASH,
        basis: ILIT_STARTING_CASH,
        growthRate: 0,
        rmdEnabled: false,
        isDefaultChecking: true,
        owners: [{ kind: "entity", entityId: ILIT_ID, percent: 1 }],
      },
      policyAccount,
    ],
    incomes: [],
    expenses: [],
    savingsRules: [],
    liabilities: [],
    withdrawalStrategy: [],
    giftEvents: [],
    entities: [
      {
        id: ILIT_ID,
        name: "Family ILIT",
        includeInPortfolio: false,
        isGrantor: true,
        isIrrevocable: true,
        entityType: "trust",
      },
    ],
    planSettings: {
      planStartYear: 2026,
      planEndYear: 2027,
      inflationRate: 0,
      taxMode: "flat",
      flatTaxRate: 0,
    },
  } as unknown as ClientData;
}

describe("F12 — ILIT-owned policy with a scheduled premium", () => {
  const data = withSynthesizedPremiums(buildIlitPolicyFixture());
  const years = runProjection(data);

  it("synthesizes an entity-owned premium expense carrying the schedule", () => {
    const premium = data.expenses.find((e) => e.source === "policy");
    expect(premium).toBeDefined();
    expect(premium!.ownerEntityId).toBe(ILIT_ID);
    expect(premium!.annualAmount).toBe(0);
    expect(premium!.scheduleOverrides).toEqual({
      2026: PREMIUM_2026,
      2027: PREMIUM_2027,
    });
  });

  it("debits the ILIT checking by the SCHEDULED premium each year", () => {
    const y2026 = years.find((y) => y.year === 2026)!;
    const ilit2026 = y2026.accountLedgers[ILIT_CHECKING_ID];
    expect(ilit2026).toBeDefined();
    expect(ilit2026.endingValue).toBeCloseTo(
      ILIT_STARTING_CASH - PREMIUM_2026, 2,
    );

    const y2027 = years.find((y) => y.year === 2027)!;
    const ilit2027 = y2027.accountLedgers[ILIT_CHECKING_ID];
    expect(ilit2027.endingValue).toBeCloseTo(
      ILIT_STARTING_CASH - PREMIUM_2026 - PREMIUM_2027, 2,
    );
  });
});
