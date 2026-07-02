import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { basePlanSettings, buildClientData, sampleFamilyMembers } from "./fixtures";
import { LEGACY_FM_CLIENT, EDUCATION_529_SENTINEL_OWNER_ID } from "../ownership";
import {
  computeInEstateAtYear,
  computeOutOfEstateAtYear,
} from "../../lib/estate/in-estate-at-year";
import type { Account, ClientData, Expense, FamilyMember, Income, ProjectionYear, SavingsRule } from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";

/**
 * Task 13 — GOLDEN end-to-end 529 projection.
 *
 * One fixture exercises the whole 529 arc, and a no-529 CONTROL run isolates the
 * NY-state-tax effect. This is the regression pin for the entire education-529
 * feature (Tasks 2–12); it deliberately asserts each stage precisely so a
 * future change that breaks any one seam trips here.
 *
 * The arc (planStartYear 2026 → planEndYear 2045):
 *   • NY-resident MFJ household, $200k salary — bracket-mode tax so the NY 529
 *     subtraction is live.
 *   • A household-grantor 529 (LEGACY_FM_CLIENT grantor) starts at $20,000 and
 *     grows 5%/yr tax-free.
 *   • $10,000/yr contributions (2026–2045) debit household checking AND earn the
 *     NY 529 deduction (MFJ cap $10k → fully deductible).
 *   • An education goal spends $30,000/yr for 4 years (2033–2036, "year 8"),
 *     drawn tax-free from the 529.
 *   • Rollover enabled from 2038 ("year 13") into a household Roth: $7k/yr
 *     (beneficiary's base IRA limit) until the $35,000 lifetime cap binds.
 *   • The 529 is never in `computeInEstateAtYear` and always in
 *     `computeOutOfEstateAtYear`.
 *
 * Balances are pinned by RELATIONSHIP against the engine's own reported BOY
 * (EOY == BOY·1.05 + contribution − draw) rather than hard-coded compounded
 * constants, so the test pins the growth→contribution→draw→rollover ORDER
 * without silently mirroring a mis-added constant.
 */

const START_YEAR = 2026;
const END_YEAR = 2045;
const EDU_START = 2033; // year 8
const EDU_END = 2036; // 4 years × $30k
const ROLLOVER_START = 2038; // year 13
const GROWTH = 0.05;
const CONTRIB = 10_000;
const EDU_COST = 30_000;
const IRA_LIMIT = 7_000; // beneficiary under 50 → base limit, no catch-up
const LIFETIME_CAP = 35_000;

// Minimal 2026 federal params: real MFJ brackets so bracket-mode is active and
// the state engine (its own tables) computes NY tax. Frozen for 2027+ (the
// resolver holds the latest seeded year), which is fine — NY 529 rules and the
// state bracket tables are year-independent in v1.
const TAX_YEAR_2026: TaxYearParameters = {
  year: 2026,
  incomeBrackets: {
    married_joint: [
      { from: 0, to: 23200, rate: 0.1 },
      { from: 23200, to: 94300, rate: 0.12 },
      { from: 94300, to: 201050, rate: 0.22 },
      { from: 201050, to: 383900, rate: 0.24 },
      { from: 383900, to: 487450, rate: 0.32 },
      { from: 487450, to: 731200, rate: 0.35 },
      { from: 731200, to: null, rate: 0.37 },
    ],
    single: [{ from: 0, to: null, rate: 0.22 }],
    head_of_household: [{ from: 0, to: null, rate: 0.22 }],
    married_separate: [{ from: 0, to: null, rate: 0.22 }],
  },
  capGainsBrackets: {
    married_joint: { zeroPctTop: 94050, fifteenPctTop: 583750 },
    single: { zeroPctTop: 47025, fifteenPctTop: 518900 },
    head_of_household: { zeroPctTop: 63000, fifteenPctTop: 551350 },
    married_separate: { zeroPctTop: 47025, fifteenPctTop: 291850 },
  },
  trustIncomeBrackets: [
    { from: 0, to: 3300, rate: 0.1 },
    { from: 3300, to: null, rate: 0.37 },
  ],
  trustCapGainsBrackets: [
    { from: 0, to: 3350, rate: 0 },
    { from: 3350, to: null, rate: 0.2 },
  ],
  stdDeduction: { married_joint: 30000, single: 15000, head_of_household: 21900, married_separate: 15000 },
  amtExemption: { mfj: 137000, singleHoh: 88100, mfs: 68500 },
  amtBreakpoint2628: { mfjShoh: 239100, mfs: 119550 },
  amtPhaseoutStart: { mfj: 1237450, singleHoh: 618700, mfs: 618725 },
  ssTaxRate: 0.062,
  ssWageBase: 176100,
  medicareTaxRate: 0.0145,
  addlMedicareRate: 0.009,
  addlMedicareThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
  niitRate: 0.038,
  niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
  qbi: {
    thresholdMfj: 383900,
    thresholdSingleHohMfs: 191950,
    phaseInRangeMfj: 100000,
    phaseInRangeOther: 50000,
  },
  contribLimits: {
    ira401kElective: 23500,
    ira401kCatchup50: 7500,
    ira401kCatchup6063: 11250,
    iraTradLimit: 7000,
    iraCatchup50: 1000,
    simpleLimitRegular: 17000,
    simpleCatchup50: 4000,
    hsaLimitSelf: 4400,
    hsaLimitFamily: 8750,
    hsaCatchup55: 1000,
  },
};

// Beneficiary born 2007 → age 31 in 2038 (base IRA limit, no catch-up).
const beneficiaryKid: FamilyMember = {
  id: "kid-1",
  role: "child",
  relationship: "child",
  firstName: "Kid",
  lastName: "Smith",
  dateOfBirth: "2007-06-01",
};

// growthRate 0 so household cash never generates interest — the ONLY tax
// difference between the golden and control runs is the 529 state deduction.
const checking: Account = {
  id: "chk",
  name: "Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 200_000,
  basis: 200_000,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const education529: Account = {
  id: "the-529",
  name: "College 529",
  category: "education_savings",
  subType: "529",
  titlingType: "jtwros",
  value: 20_000,
  basis: 20_000,
  growthRate: GROWTH,
  rmdEnabled: false,
  education529: {
    grantorFamilyMemberId: LEGACY_FM_CLIENT, // household grantor → checking debited + NY deduction
    beneficiaryFamilyMemberId: "kid-1",
    beneficiaryName: "Kid",
    rothRolloverEnabled: true,
    rothRolloverStartYear: ROLLOVER_START,
    rothRolloverAccountId: "kid-roth",
  },
  owners: [{ kind: "external_beneficiary", externalBeneficiaryId: EDUCATION_529_SENTINEL_OWNER_ID, percent: 1 }],
};

// Household Roth (growth 0 so rolled principal is the ending balance) — the
// rollover destination.
const kidRoth: Account = {
  id: "kid-roth",
  name: "Household Roth IRA",
  category: "retirement",
  subType: "roth_ira",
  titlingType: "jtwros",
  value: 0,
  basis: 0,
  growthRate: 0,
  rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const salary: Income = {
  id: "inc-salary",
  type: "salary",
  name: "Client Salary",
  annualAmount: 200_000,
  startYear: START_YEAR,
  endYear: END_YEAR,
  growthRate: 0,
  owner: "client",
};

const contribRule: SavingsRule = {
  id: "sav-529",
  accountId: "the-529",
  annualAmount: CONTRIB,
  isDeductible: false, // not federally deductible; NY subtraction handled in state engine
  startYear: START_YEAR,
  endYear: END_YEAR,
};

const eduExpense: Expense = {
  id: "edu",
  type: "education",
  name: "College",
  annualAmount: EDU_COST,
  startYear: EDU_START,
  endYear: EDU_END,
  growthRate: 0, // flat $30k/yr — clean draw schedule
  dedicatedAccountIds: ["the-529"],
  payShortfallOutOfPocket: false,
};

function makeData(opts: { with529: boolean }): ClientData {
  const base = buildClientData({
    planSettings: {
      ...basePlanSettings,
      flatFederalRate: 0,
      flatStateRate: 0,
      inflationRate: 0,
      planStartYear: START_YEAR,
      planEndYear: END_YEAR,
      taxEngineMode: "bracket",
      residenceState: "NY",
    },
    familyMembers: [...sampleFamilyMembers, beneficiaryKid],
  });
  return {
    ...base,
    accounts: opts.with529 ? [checking, education529, kidRoth] : [checking],
    incomes: [salary],
    expenses: opts.with529 ? [eduExpense] : [],
    liabilities: [],
    savingsRules: opts.with529 ? [contribRule] : [],
    withdrawalStrategy: [],
    taxYearRows: [TAX_YEAR_2026],
  } as ClientData;
}

/** Ledger ending balances → the Map shape the estate helpers consume. */
function balancesFromYear(y: ProjectionYear): Map<string, number> {
  const m = new Map<string, number>();
  for (const [id, led] of Object.entries(y.accountLedgers)) m.set(id, led.endingValue);
  return m;
}

const goldenData = makeData({ with529: true });
const goldenYears = runProjection(goldenData);
const controlYears = runProjection(makeData({ with529: false }));

const golden = (year: number) => goldenYears.find((y) => y.year === year)!;
const control = (year: number) => controlYears.find((y) => y.year === year)!;
const eduRow = (year: number) => golden(year).educationGoals?.find((g) => g.goalId === "edu");
const led529 = (year: number) => golden(year).accountLedgers["the-529"];
const ledRoth = (year: number) => golden(year).accountLedgers["kid-roth"];

describe("529 golden end-to-end", () => {
  it("projects the full horizon", () => {
    expect(goldenYears).toHaveLength(END_YEAR - START_YEAR + 1);
    expect(controlYears).toHaveLength(END_YEAR - START_YEAR + 1);
  });

  it("accumulation years: balance grows tax-free and each contribution compounds on the engine's own BOY", () => {
    // Year 1 is exact: 20,000·1.05 + 10,000 = 31,000.
    const r2026 = eduRow(2026)!;
    expect(r2026.accumulation).toBe(true);
    expect(r2026.dedicatedAssetsBOY).toBeCloseTo(20_000, 6);
    expect(r2026.growthAndSavings).toBeCloseTo(20_000 * GROWTH + CONTRIB, 6); // 1,000 growth + 10,000 contribution
    expect(r2026.dedicatedAssetsEOY).toBeCloseTo(31_000, 6);

    // 2027–2032: pin the growth→contribution ORDER against the reported BOY.
    for (let year = 2027; year < EDU_START; year++) {
      const r = eduRow(year)!;
      expect(r.accumulation).toBe(true);
      const boy = r.dedicatedAssetsBOY;
      expect(r.growthAndSavings).toBeCloseTo(boy * GROWTH + CONTRIB, 4);
      expect(r.dedicatedAssetsEOY).toBeCloseTo(boy * (1 + GROWTH) + CONTRIB, 4);
      // strictly increasing while accumulating
      expect(r.dedicatedAssetsEOY).toBeGreaterThan(boy);
      // no education draw during accumulation
      expect(r.dedicatedWithdrawal).toBe(0);
      expect(r.goalExpense).toBe(0);
    }
  });

  it("contribution years debit household checking (household-grantor 529)", () => {
    for (const year of [2026, 2030, 2040]) {
      // The $10k 529 contribution is the only savings_contribution debit on
      // checking (salary/tax movements use other categories).
      const debit = golden(year)
        .accountLedgers["chk"].entries.filter((e) => e.category === "savings_contribution")
        .reduce((s, e) => s + e.amount, 0);
      expect(debit).toBe(-CONTRIB);
      // Counterparty wiring: the 529 credit points back at checking — proving
      // the money came from household cash, not from outside the plan.
      const credit = led529(year).entries.find((e) => e.category === "savings_contribution");
      expect(credit?.amount).toBe(CONTRIB);
      expect(credit?.counterpartyId).toBe("chk");
    }
  });

  it("NY state tax: golden pays less than the no-529 control by exactly the $10k subtraction; federal is unchanged", () => {
    for (const year of [2026, 2029, 2032]) {
      const g = golden(year).taxResult!;
      const c = control(year).taxResult!;
      expect(g.state?.state).toBe("NY");
      expect(g.state?.hasIncomeTax).toBe(true);

      // The ONLY state-tax difference is the 529 subtraction → $10k lower taxable income.
      expect(c.state!.stateTaxableIncome - g.state!.stateTaxableIncome).toBeCloseTo(CONTRIB, 4);
      // NY marginal ~6% on $10k → a few hundred dollars less state tax.
      expect(c.state!.stateTax - g.state!.stateTax).toBeGreaterThan(300);
      // The golden run's diag names the 529 subtraction; the control has no such note.
      expect(g.state!.diag.notes.some((n) => n.includes("529"))).toBe(true);
      expect(c.state!.diag.notes.some((n) => n.includes("529"))).toBe(false);
    }
  });

  it("529 activity is federally tax-free every year: golden vs control federal tax is identical", () => {
    // Salary ($200k) is the sole federal income in BOTH runs — 529 growth,
    // education draws and the Roth rollover generate zero federal income — so
    // federal tax must match year-for-year across the whole horizon.
    for (let year = START_YEAR; year <= END_YEAR; year++) {
      expect(golden(year).taxResult!.flow.totalFederalTax).toBeCloseTo(
        control(year).taxResult!.flow.totalFederalTax,
        2,
      );
    }
  });

  it("education years: draws $30k/yr tax-free from the 529, fully funded, no shortfall", () => {
    for (let year = EDU_START; year <= EDU_END; year++) {
      const r = eduRow(year)!;
      expect(r.accumulation).toBeFalsy();
      expect(r.goalExpense).toBeCloseTo(EDU_COST, 6);
      expect(r.dedicatedWithdrawal).toBeCloseTo(EDU_COST, 6);
      expect(r.shortfall).toBe(0);
      expect(r.outOfPocketWithdrawal).toBe(0);

      // Reconciliation: EOY = BOY + (growth + contribution) − draw, no residual.
      const boy = r.dedicatedAssetsBOY;
      expect(r.growthAndSavings).toBeCloseTo(boy * GROWTH + CONTRIB, 4);
      expect(r.dedicatedAssetsEOY).toBeCloseTo(boy * (1 + GROWTH) + CONTRIB - EDU_COST, 4);

      // Tax-free: the education draw books no ordinary income / cap gains source.
      expect(golden(year).taxDetail!.bySource["education:edu"]).toBeUndefined();
    }
  });

  it("rollover: $7k/yr drips to the household Roth, stopping at the $35k lifetime cap", () => {
    // No rollover before the start year.
    for (let year = START_YEAR; year < ROLLOVER_START; year++) {
      const rollEntries = ledRoth(year).entries.filter((e) => e.label === "Rollover from 529");
      expect(rollEntries).toHaveLength(0);
    }

    // 2038–2042: exactly $7,000/yr rolled in.
    for (let year = ROLLOVER_START; year <= ROLLOVER_START + 4; year++) {
      const inflow = ledRoth(year).entries
        .filter((e) => e.label === "Rollover from 529")
        .reduce((s, e) => s + e.amount, 0);
      expect(inflow).toBe(IRA_LIMIT);
      const outflow = led529(year).entries
        .filter((e) => e.label === "529 → Roth IRA rollover")
        .reduce((s, e) => s + e.amount, 0);
      expect(outflow).toBe(-IRA_LIMIT);
    }

    // Cap exhausted the year after the 5th roll — no more movement.
    for (let year = ROLLOVER_START + 5; year <= END_YEAR; year++) {
      expect(ledRoth(year).entries.filter((e) => e.label === "Rollover from 529")).toHaveLength(0);
      expect(led529(year).entries.filter((e) => e.label === "529 → Roth IRA rollover")).toHaveLength(0);
    }

    // Cumulative rolled principal == the $35,000 lifetime cap, exactly.
    const totalIn = goldenYears.reduce(
      (s, y) =>
        s +
        (y.accountLedgers["kid-roth"]?.entries ?? [])
          .filter((e) => e.label === "Rollover from 529")
          .reduce((a, e) => a + e.amount, 0),
      0,
    );
    const totalOut = goldenYears.reduce(
      (s, y) =>
        s +
        (y.accountLedgers["the-529"]?.entries ?? [])
          .filter((e) => e.label === "529 → Roth IRA rollover")
          .reduce((a, e) => a - e.amount, 0),
      0,
    );
    expect(totalIn).toBeCloseTo(LIFETIME_CAP, 6);
    expect(totalOut).toBeCloseTo(LIFETIME_CAP, 6);
    // Roth (growth 0) holds exactly the rolled principal at the end.
    expect(golden(END_YEAR).accountLedgers["kid-roth"].endingValue).toBeCloseTo(LIFETIME_CAP, 6);
  });

  it("estate: the 529 is always OUT of estate, never IN, at every stage of the arc", () => {
    // One representative year per phase: accumulation, education, rollover.
    for (const year of [2030, 2035, 2040]) {
      const y = golden(year);
      const balances = balancesFromYear(y);
      const args = {
        tree: goldenData,
        giftEvents: [],
        year,
        projectionStartYear: START_YEAR,
        accountBalances: balances,
      };
      const bal529 = balances.get("the-529")!;
      expect(bal529).toBeGreaterThan(0);

      const outEstate = computeOutOfEstateAtYear(args);
      const inEstate = computeInEstateAtYear(args);

      // Out-of-estate == the full 529 balance (every other account is
      // family-member-owned → weight 0 out).
      expect(outEstate).toBeCloseTo(bal529, 4);
      // In-estate == household accounts only, the 529 fully excluded.
      const householdOnly =
        (balances.get("chk") ?? 0) + (balances.get("kid-roth") ?? 0);
      expect(inEstate).toBeCloseTo(householdOnly, 4);
      expect(inEstate).not.toBeCloseTo(householdOnly + bal529, 4);
    }
  });
});
