import { describe, it, expect } from "vitest";
import { deriveSpineData } from "./derive-spine-data";
import { buildClientData } from "@/engine/__tests__/fixtures";
import { runProjectionWithEvents } from "@/engine";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "@/engine/ownership";
import type { ClientData } from "@/engine/types";

// ── Fixture helpers ───────────────────────────────────────────────────────────

/**
 * Two-grantor fixture: both spouses alive at plan start (2026).
 * Client born 1970 with LE 78 → dies 2048.
 * Spouse born 1972 with LE 82 → dies 2054.
 * Plan runs 2026–2060, so both events land within the window.
 */
function twoGrantorFixture(): ClientData {
  return buildClientData({
    client: {
      firstName: "Tom",
      lastName: "Cooper",
      dateOfBirth: "1970-01-01",
      retirementAge: 65,
      planEndAge: 90,
      lifeExpectancy: 78,
      filingStatus: "married_joint",
      spouseName: "Linda Cooper",
      spouseDob: "1972-06-15",
      spouseRetirementAge: 65,
      spouseLifeExpectancy: 82,
    },
    planSettings: {
      flatFederalRate: 0.22,
      flatStateRate: 0.05,
      inflationRate: 0.03,
      planStartYear: 2026,
      planEndYear: 2060,
    },
    familyMembers: [
      {
        id: LEGACY_FM_CLIENT,
        role: "client",
        relationship: "other",
        firstName: "Tom",
        lastName: "Cooper",
        dateOfBirth: "1970-01-01",
      },
      {
        id: LEGACY_FM_SPOUSE,
        role: "spouse",
        relationship: "other",
        firstName: "Linda",
        lastName: "Cooper",
        dateOfBirth: "1972-06-15",
      },
      {
        id: "fm-child-1",
        role: "child",
        relationship: "child",
        firstName: "Alex",
        lastName: "Cooper",
        dateOfBirth: "2000-05-20",
      },
    ],
  });
}

/**
 * Single-grantor fixture: single filer (no spouse).
 * Client born 1960, LE 85 → dies 2045 (inside plan window).
 * Accounts are all solo-owned by the client (no joint accounts — joint accounts
 * would trigger an engine invariant error for a single filer with no first-death event
 * to retitle them).
 */
function singleGrantorFixture(): ClientData {
  return buildClientData({
    client: {
      firstName: "Carol",
      lastName: "Davis",
      dateOfBirth: "1960-01-01",
      retirementAge: 65,
      planEndAge: 90,
      lifeExpectancy: 85,
      filingStatus: "single",
      // No spouseDob — single filer
    },
    planSettings: {
      flatFederalRate: 0.22,
      flatStateRate: 0.05,
      inflationRate: 0.03,
      planStartYear: 2026,
      planEndYear: 2060,
    },
    familyMembers: [
      {
        id: LEGACY_FM_CLIENT,
        role: "client",
        relationship: "other",
        firstName: "Carol",
        lastName: "Davis",
        dateOfBirth: "1960-01-01",
      },
      {
        id: "fm-child-2",
        role: "child",
        relationship: "child",
        firstName: "Sam",
        lastName: "Davis",
        dateOfBirth: "1985-03-15",
      },
    ],
    // Override accounts to solo-client-owned only (no joint accounts for single filer)
    accounts: [
      {
        id: "acct-401k-carol",
        name: "Carol 401(k)",
        category: "retirement",
        subType: "401k",
        value: 800000,
        basis: 800000,
        growthRate: 0.07,
        rmdEnabled: true,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
      {
        id: "acct-brokerage-carol",
        name: "Carol Brokerage",
        category: "taxable",
        subType: "brokerage",
        value: 400000,
        basis: 280000,
        growthRate: 0.06,
        rmdEnabled: false,
        owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
      },
    ],
    // Remove savings rules and withdrawal strategy that reference the old account ids
    savingsRules: [],
    withdrawalStrategy: [
      { accountId: "acct-brokerage-carol", priorityOrder: 1, startYear: 2026, endYear: 2060 },
      { accountId: "acct-401k-carol", priorityOrder: 2, startYear: 2026, endYear: 2060 },
    ],
    // Remove joint incomes, keep only client-owned ones
    incomes: [
      {
        id: "inc-salary-carol",
        type: "salary",
        name: "Carol Salary",
        annualAmount: 120000,
        startYear: 2026,
        endYear: 2035,
        growthRate: 0.03,
        owner: "client",
      },
    ],
    // Remove mortgage (was joint)
    liabilities: [],
  });
}

/**
 * Historical fixture: both grantors deceased before the plan start year.
 * We achieve this by providing no lifeExpectancy so computeFirstDeathYear
 * returns null AND firstDeathEvent is undefined. But both are "deceased" by
 * the plan start. The engine can't really model this — so deriveSpineData
 * should fall back to { kind: "historical" }.
 *
 * The simplest way to trigger "historical" is to have:
 *   - No spouseDob (or spouseDob with LE that puts both deaths before start)
 *   - No lifeExpectancy set → engine emits no death events
 * In this case firstDeathEvent=undefined AND secondDeathEvent=undefined.
 *
 * Per the spec logic: if we can't determine a death year within the plan window
 * at all, we return { kind: "historical" }.
 */
function historicalFixture(): ClientData {
  return buildClientData({
    client: {
      firstName: "Old",
      lastName: "Person",
      dateOfBirth: "1920-01-01",
      retirementAge: 65,
      planEndAge: 90,
      // No lifeExpectancy → computeFirstDeathYear returns null
      filingStatus: "single",
    },
    planSettings: {
      flatFederalRate: 0.22,
      flatStateRate: 0.05,
      inflationRate: 0.03,
      planStartYear: 2026,
      planEndYear: 2060,
    },
    familyMembers: [
      {
        id: LEGACY_FM_CLIENT,
        role: "client",
        relationship: "other",
        firstName: "Old",
        lastName: "Person",
        dateOfBirth: "1920-01-01",
      },
    ],
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("deriveSpineData", () => {
  it("returns 'two-grantor' variant when both grantors alive at plan start", () => {
    const tree = twoGrantorFixture();
    const withResult = runProjectionWithEvents(tree);
    const data = deriveSpineData({ tree, withResult });

    expect(data.kind).toBe("two-grantor");
    if (data.kind !== "two-grantor") return;

    // Today year
    expect(data.today.year).toBe(2026);

    // First death: Tom dies at age 78 (born 1970 → 2048)
    expect(data.firstDeath.deceasedName).toBe("Tom");
    expect(data.firstDeath.year).toBe(2048);

    // Second death: Linda dies at age 82 (born 1972 → 2054)
    expect(data.secondDeath.deceasedName).toBe("Linda");
    expect(data.secondDeath.year).toBe(2054);

    // Pair net-worth should be positive numbers
    expect(data.pair.client.name).toBe("Tom");
    expect(data.pair.client.netWorth).toBeGreaterThanOrEqual(0);
    expect(data.pair.spouse.name).toBe("Linda");
    expect(data.pair.spouse.netWorth).toBeGreaterThanOrEqual(0);

    // First-death marital deduction should be non-zero (married couple, everything passes to survivor)
    expect(data.firstDeath.toSpouse).toBeGreaterThan(0);

    // Beneficiaries list has at least one entry (the child, via fallback)
    expect(data.beneficiaries.length).toBeGreaterThan(0);

    // First beneficiary card shape
    const card = data.beneficiaries[0];
    expect(card.name).toBeTruthy();
    expect(typeof card.value).toBe("number");
    expect(card.value).toBeGreaterThan(0);
    expect(card.pctOfHeirs).toBeGreaterThan(0);
    expect(card.pctOfHeirs).toBeLessThanOrEqual(1);

    // Totals are numbers
    expect(typeof data.totals.taxesAndExpenses).toBe("number");
    expect(typeof data.totals.toHeirs).toBe("number");
  });

  it("two-grantor: pair.netWorth reflects plan-start-year balances, not first-death-year balances", () => {
    // Bug fix: pair.client.netWorth and pair.spouse.netWorth render under a
    // "TODAY ${planStartYear}" timeline tick, but were being computed from the
    // first-death-year grossEstate (~2048 in this fixture). With 5%+ growth
    // rates compounded over ~22 years, the first-death values are several
    // multiples of the year-zero values.
    const tree = twoGrantorFixture();
    const withResult = runProjectionWithEvents(tree);
    const data = deriveSpineData({ tree, withResult });
    if (data.kind !== "two-grantor") throw new Error("expected two-grantor");

    const pairTotal = data.pair.client.netWorth + data.pair.spouse.netWorth;
    const yearZeroPortfolio = withResult.years[0].portfolioAssets.total;
    const firstDeathGross = withResult.firstDeathEvent?.grossEstate ?? 0;

    // Pair total should be on the order of year-zero portfolio (give or take
    // liabilities and gross-vs-net treatment), NOT the at-first-death snapshot.
    expect(pairTotal).toBeLessThan(yearZeroPortfolio * 1.5);
    expect(pairTotal).toBeGreaterThan(yearZeroPortfolio * 0.3);
    // And materially smaller than the deceased's at-first-death grossEstate.
    expect(pairTotal).toBeLessThan(firstDeathGross * 0.5);
  });

  it("returns 'single-grantor' when only one grantor is in the plan (no spouse)", () => {
    const tree = singleGrantorFixture();
    const withResult = runProjectionWithEvents(tree);
    const data = deriveSpineData({ tree, withResult });

    expect(data.kind).toBe("single-grantor");
    if (data.kind !== "single-grantor") return;

    expect(data.survivorName).toBe("Carol");

    // Carol born 1960, LE 85 → dies 2045
    expect(data.death.year).toBe(2045);

    expect(typeof data.death.tax).toBe("number");
    expect(typeof data.death.toHeirs).toBe("number");
    expect(data.beneficiaries.length).toBeGreaterThan(0);

    // First beneficiary card shape
    const card = data.beneficiaries[0];
    expect(card.name).toBeTruthy();
    expect(typeof card.value).toBe("number");
    expect(card.value).toBeGreaterThan(0);
    expect(card.pctOfHeirs).toBeGreaterThan(0);
    expect(card.pctOfHeirs).toBeLessThanOrEqual(1);

    expect(typeof data.totals.taxesAndExpenses).toBe("number");
    expect(typeof data.totals.toHeirs).toBe("number");
  });

  it("returns 'historical' when no death events fall within the plan window", () => {
    const tree = historicalFixture();
    const withResult = runProjectionWithEvents(tree);
    const data = deriveSpineData({ tree, withResult });

    expect(data.kind).toBe("historical");
    if (data.kind !== "historical") return;

    expect(typeof data.message).toBe("string");
    expect(data.message.length).toBeGreaterThan(0);
  });
});
