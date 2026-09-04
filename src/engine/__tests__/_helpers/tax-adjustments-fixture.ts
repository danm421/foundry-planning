import type { ClientData, FamilyMember, PlanSettings } from "../../types";
import { TAX_YEAR_2026 } from "../_fixtures/tax-year-2026";

const CLIENT_FM_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Minimal single-household plan for the tax-adjustment integration tests:
 * one salaried client, one cash account big enough that no supplemental
 * withdrawal ever fires, and no expenses. Copied from the minimal household in
 * `charitable-deduction-integration.test.ts`.
 *
 * Year 0 (2026) books $1,000,000 of salary, so the household sits well inside a
 * real bracket and an adjustment moves a measurable amount of tax. The flat
 * rates are non-zero so `taxEngineMode: "flat"` produces
 * `totalTax = taxableIncome × (flatFederalRate + flatStateRate)`.
 */
export function buildBaseClient(settingsOverride?: Partial<PlanSettings>): ClientData {
  return {
    client: {
      firstName: "Adjustment",
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
        owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
      } as ClientData["accounts"][number],
    ],
    incomes: [
      {
        id: "inc-salary",
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
      flatFederalRate: 0.24,
      flatStateRate: 0.06,
      inflationRate: 0,
      planStartYear: 2026,
      planEndYear: 2030,
      taxEngineMode: "bracket",
      taxInflationRate: 0.025,
      estateAdminExpenses: 0,
      flatStateEstateRate: 0,
      ...settingsOverride,
    },
    entities: [],
    deductions: [],
    transfers: [],
    assetTransactions: [],
    gifts: [],
    giftEvents: [],
    taxYearRows: [TAX_YEAR_2026],
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
    externalBeneficiaries: [],
  } as ClientData;
}
