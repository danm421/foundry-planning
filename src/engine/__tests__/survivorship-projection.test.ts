import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import type {
  Account,
  ClientData,
  ClientInfo,
  Income,
  PlanSettings,
} from "../types";
import { LEGACY_FM_CLIENT } from "../ownership";

/**
 * Task 6 — end-to-end reconciliation golden for deferred-income survivorship.
 *
 * Two-spouse household. The deferred-income owner (client) dies FIRST (2045);
 * the surviving spouse lives to 2052. One deferred income carries
 * survivorshipPct = 0.5 with a plain annualAmount + growthRate (NOT
 * scheduleOverrides). This test ties together:
 *   · Task 4 — cash-flow continuation: the reduced (0.5×) stream continues to
 *     the survivor and stops at the survivor's death year.
 *   · Task 5 — estate PV inclusion: the first-death gross estate carries a
 *     "Survivor annuity — …" §2039 add-back line.
 *
 * It also ARBITRATES the open Task-4 question: does the owner's DEATH YEAR pay
 * the FULL (unscaled) benefit ("death year runs to completion"), or the reduced
 * amount? See the observed-behavior comment on assertion #1 below.
 */

// ── Fixture constants ────────────────────────────────────────────────────────
const BASE_AMOUNT = 100_000;
const GROWTH = 0.03;
const DEFERRED_START = 2030; // income already active well before first death
const SURVIVORSHIP_PCT = 0.5;

const OWNER_DEATH_YEAR = 2045; // client born 1970 + LE 75
const SURVIVOR_DEATH_YEAR = 2052; // spouse born 1972 + LE 80

/** projected (unscaled) benefit for `year`, per computeIncome's growth-from-
 *  startYear rule: annualAmount × (1+growth)^(year − startYear). */
function projectedBenefit(year: number): number {
  return BASE_AMOUNT * Math.pow(1 + GROWTH, year - DEFERRED_START);
}

function buildData(): ClientData {
  const client: ClientInfo = {
    firstName: "Owner",
    lastName: "Deferred",
    dateOfBirth: "1970-01-01",
    retirementAge: 65,
    planEndAge: 95,
    filingStatus: "married_joint",
    lifeExpectancy: 75, // dies 2045 (first death)
    spouseDob: "1972-01-01",
    spouseLifeExpectancy: 80, // dies 2052 (final death)
  };

  const planSettings: PlanSettings = {
    flatFederalRate: 0,
    flatStateRate: 0,
    inflationRate: 0.025,
    planStartYear: 2026,
    planEndYear: 2066,
    taxInflationRate: 0.025,
    estateAdminExpenses: 0,
    flatStateEstateRate: 0,
    // Give the §2039 PV inclusion a positive discount rate to work with.
    pvDiscountRate: 0.04,
  };

  // A household cash account so the deferred income has somewhere to deposit and
  // so the projection has a non-trivial balance sheet.
  const accounts: Account[] = [
    {
      id: "hh-cash",
      name: "Household Cash",
      category: "cash",
      subType: "savings",
      titlingType: "jtwros",
      value: 250_000,
      basis: 250_000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    },
  ];

  // The deferred income the client owns, with a 50% survivor continuation.
  const incomes: Income[] = [
    {
      id: "def-1",
      type: "deferred",
      name: "Nonqualified Deferred Comp",
      annualAmount: BASE_AMOUNT,
      startYear: DEFERRED_START,
      endYear: 2060, // beyond survivor death; termination must clip it
      growthRate: GROWTH,
      owner: "client",
      survivorshipPct: SURVIVORSHIP_PCT,
      taxType: "ordinary_income",
    },
  ];

  return {
    client,
    accounts,
    incomes,
    expenses: [],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
    planSettings,
    familyMembers: [],
    wills: [],
    giftEvents: [],
  };
}

describe("deferred-income survivorship end-to-end", () => {
  it("continues the reduced benefit to the survivor and includes its PV in the estate", () => {
    const years = runProjection(buildData());
    const yearOf = (y: number) => years.find((r) => r.year === y);

    const deathYr = yearOf(OWNER_DEATH_YEAR);
    const survivorYr = yearOf(OWNER_DEATH_YEAR + 1);
    expect(deathYr).toBeDefined();
    expect(survivorYr).toBeDefined();

    // ── Assertion 1: owner's DEATH YEAR pays the FULL (unscaled) benefit. ──────
    // OBSERVED BEHAVIOR (empirically verified in this run): the death year pays
    // the FULL benefit — "death year runs to completion". runProjection computes
    // the year's income (computeIncome, projection.ts:926) on the PRE-termination
    // incomes at the top of the loop; the first-death event (projection.ts:6127)
    // only mutates `currentIncomes` afterward, so the scaled survivor stream
    // takes effect from death-year+1 onward. The Task-4 assumption HOLDS — no
    // `startYear = deathYear + 1` remedy was needed in shared.ts.
    expect(deathYr!.income.deferred).toBeCloseTo(projectedBenefit(OWNER_DEATH_YEAR), 0);
    expect(deathYr!.income.deferred).toBeCloseTo(155_797, -1);

    // ── Assertion 2: death-year+1 survivor cash flow ≈ 0.5 × projected benefit. ─
    expect(survivorYr!.income.deferred).toBeCloseTo(
      SURVIVORSHIP_PCT * projectedBenefit(OWNER_DEATH_YEAR + 1),
      0,
    );
    // Half, not full — the stream is genuinely reduced for the survivor.
    expect(survivorYr!.income.deferred).toBeLessThan(
      0.6 * projectedBenefit(OWNER_DEATH_YEAR + 1),
    );

    // ── Assertion 3: the deferred stream stops at the survivor's death year. ───
    // applyIncomeTermination clips the retitled income's endYear to the survivor
    // death year (2052). The projection also terminates at final death, so 2052
    // is the last projected year, it still carries the reduced benefit, and no
    // year after it exists (nothing leaks past the survivor's death).
    const survivorDeathRow = yearOf(SURVIVOR_DEATH_YEAR);
    expect(survivorDeathRow).toBeDefined();
    expect(survivorDeathRow!.income.deferred).toBeCloseTo(
      SURVIVORSHIP_PCT * projectedBenefit(SURVIVOR_DEATH_YEAR),
      0,
    );
    expect(years[years.length - 1].year).toBe(SURVIVOR_DEATH_YEAR);
    expect(years.some((y) => y.year > SURVIVOR_DEATH_YEAR)).toBe(false);

    // ── Assertion 4: first-death gross estate carries the §2039 PV add-back. ───
    const survivorAnnuityLines = (deathYr!.estateTax?.grossEstateLines ?? []).filter(
      (l) => l.label.startsWith("Survivor annuity —"),
    );
    expect(survivorAnnuityLines).toHaveLength(1);
    expect(survivorAnnuityLines[0].amount).toBeGreaterThan(0);
    // No double count: the PV inclusion is a valuation add-back, not a probate asset.
    expect(survivorAnnuityLines[0].isProbate).toBe(false);
  });
});
