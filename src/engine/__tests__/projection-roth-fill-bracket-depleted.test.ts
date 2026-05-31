import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type { ClientData, FamilyMember, RothConversion } from "../types";
import { TAX_YEAR_2026 } from "./_fixtures/tax-year-2026";

const CLIENT_FM_ID = "00000000-0000-0000-0000-000000000001";
const SPOUSE_FM_ID = "00000000-0000-0000-0000-000000000002";

/**
 * Reproduces the production over-taxation bug seen on the Income Tax + Tax
 * Bracket reports:
 *
 *   A `fill_up_bracket` conversion drains a small Trad IRA in the first year
 *   or two. In every subsequent year the IRA is EMPTY, so `applyRothConversions`
 *   actually converts $0 — but the bracket sizer keeps returning the full 22%
 *   headroom as the target, and the year's tax (`finalTaxResult`) is computed
 *   against that *uncapped* target. The result:
 *     - the income-tax "Ordinary Income" column (reads `taxResult`) shows a
 *       phantom ~headroom of conversion income that never happened, while the
 *       drill-down popover (reads `taxDetail`) shows the real, much smaller OI;
 *     - the bracket report reads `incomeTaxBase` pinned to the 22% ceiling
 *       ("$1 remaining") even though the conversion is $0;
 *     - tax is charged on income the household never recognized.
 *
 * Invariant under test: for EVERY year the income-tax report column
 * (`taxResult.income.ordinaryIncome − shortCapitalGains`) must equal the
 * drill-down total (`taxDetail.ordinaryIncome`). `finalTaxResult` must be
 * computed against the SAME ordinary income that `finalTaxDetail` records.
 */
function depletedFillBracketScenario(): ClientData {
  const conversion: RothConversion = {
    id: "rc-fill",
    name: "Fill 22%",
    destinationAccountId: "acc-roth",
    sourceAccountIds: ["acc-ira"],
    conversionType: "fill_up_bracket",
    fillUpBracket: 0.22,
    fixedAmount: 0,
    startYear: 2026,
    indexingRate: 0,
  };

  return {
    client: {
      firstName: "Cooper",
      lastName: "Test",
      dateOfBirth: "1953-01-01", // age 73 in 2026 — RMDs active, SS claimed
      spouseDob: "1955-01-01",   // age 71 in 2026
      filingStatus: "married_joint",
      retirementAge: 65,
      planEndAge: 90,
      spouseRetirementAge: 65,
    },
    accounts: [
      {
        id: "acc-checking",
        name: "Joint Checking",
        category: "cash",
        subType: "checking",
        titlingType: "jtwros",
        value: 400_000, // ample — pays conversion tax, no supplemental needed
        basis: 400_000,
        growthRate: 0,
        rmdEnabled: false,
        isDefaultChecking: true,
        owners: [
          { kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 0.5 },
          { kind: "family_member", familyMemberId: SPOUSE_FM_ID, percent: 0.5 },
        ],
      },
      {
        // Small IRA: the fill-22% conversion drains it within the first year,
        // so 2027+ are all depleted-source years.
        id: "acc-ira",
        name: "Cooper Trad IRA",
        category: "retirement",
        subType: "traditional_ira",
        titlingType: "jtwros",
        value: 150_000,
        basis: 0,
        growthRate: 0.05,
        rmdEnabled: true,
        owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
      },
      {
        id: "acc-roth",
        name: "Cooper Roth IRA",
        category: "retirement",
        subType: "roth_ira",
        titlingType: "jtwros",
        value: 0,
        basis: 0,
        growthRate: 0.05,
        rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: CLIENT_FM_ID, percent: 1 }],
      },
    ],
    incomes: [
      {
        // Mirrors the "Cooper - Other" ordinary-income line in the report.
        id: "inc-other",
        name: "Cooper - Other",
        type: "other",
        owner: "client",
        annualAmount: 17_000,
        growthRate: 0.02,
        startYear: 2026,
        endYear: 2055,
      },
      {
        id: "inc-cooper-ss",
        name: "Cooper SS",
        type: "social_security",
        owner: "client",
        annualAmount: 40_000,
        growthRate: 0.02,
        startYear: 2026,
        endYear: 2055,
        claimingAge: 67,
      },
      {
        id: "inc-spouse-ss",
        name: "Spouse SS",
        type: "social_security",
        owner: "spouse",
        annualAmount: 30_000,
        growthRate: 0.02,
        startYear: 2026,
        endYear: 2055,
        claimingAge: 67,
      },
    ],
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [
      { accountId: "acc-checking", priorityOrder: 1, startYear: 2026, endYear: 2055 },
    ],
    planSettings: {
      flatFederalRate: 0,
      flatStateRate: 0,
      inflationRate: 0,
      planStartYear: 2026,
      planEndYear: 2032,
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
    giftEvents: [],
    wills: [],
    rothConversions: [conversion],
    familyMembers: [
      {
        id: CLIENT_FM_ID,
        firstName: "Cooper",
        lastName: "Test",
        relationship: "other",
        role: "client",
        dateOfBirth: "1953-01-01",
      } as FamilyMember,
      {
        id: SPOUSE_FM_ID,
        firstName: "Partner",
        lastName: "Test",
        relationship: "other",
        role: "spouse",
        dateOfBirth: "1955-01-01",
      } as FamilyMember,
    ],
    externalBeneficiaries: [],
    taxYearRows: [TAX_YEAR_2026],
  } as ClientData;
}

describe("Roth fill_up_bracket — depleted source must not phantom-tax", () => {
  const years = runProjection(depletedFillBracketScenario());

  it("report column (taxResult) equals drill-down total (taxDetail) every year", () => {
    for (const year of years) {
      const tr = year.taxResult;
      const td = year.taxDetail;
      if (!tr || !td) continue;
      // Income-tax report "Ordinary Income" column formula, verbatim.
      const column = tr.income.ordinaryIncome - tr.income.shortCapitalGains;
      expect(
        Math.abs(column - td.ordinaryIncome),
        `year ${year.year}: report column ${Math.round(column)} must equal ` +
          `drill-down total ${Math.round(td.ordinaryIncome)} ` +
          `(phantom = ${Math.round(column - td.ordinaryIncome)})`,
      ).toBeLessThan(1);
    }
  });

  it("once the IRA is depleted, conversion is $0 and the 22% bracket is not full", () => {
    // Last projection year — the IRA has been empty for several years.
    const last = years[years.length - 1];
    expect(last, "final year exists").toBeDefined();

    const convTaxable = (last.rothConversions ?? []).reduce(
      (s, c) => s + c.taxable,
      0,
    );
    expect(convTaxable, "no conversion once IRA is empty").toBe(0);

    const incomeTaxBase = last.taxResult!.flow.incomeTaxBase;
    const brackets = last.taxResult!.diag.incomeBracketsForFiling;
    const tier22 = brackets.find((t) => Math.abs(t.rate - 0.22) < 1e-9);
    expect(tier22, "22% tier exists").toBeDefined();
    // Pre-fix the phantom conversion pinned incomeTaxBase at the 22% ceiling
    // ("$1 remaining"). With no conversion to fund, the household's real base
    // must fall BELOW the 22% bracket floor entirely.
    expect(
      incomeTaxBase,
      `incomeTaxBase ${Math.round(incomeTaxBase)} must drop below the 22% ` +
        `bracket floor ${tier22!.from} once the IRA is empty`,
    ).toBeLessThan(tier22!.from);
  });
});
