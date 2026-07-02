import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { basePlanSettings, buildClientData } from "./fixtures";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, Expense } from "../types";

/**
 * Task 4 — applyEducationFunding pass. Each projection year, after savings, an
 * active education goal draws its indexed cost from its dedicated accounts
 * (529 tax-free via categorizeDraw), records `educationGoals` on the year, feeds
 * taxable draw components into the year's tax, and optionally spills the
 * shortfall to household cash. These integration tests exercise the three
 * behaviors through `runProjection` end-to-end.
 *
 * The fixture is deliberately isolated (no incomes / savings / withdrawal
 * strategy / liabilities) so checking only moves when the education pass spills
 * an out-of-pocket shortfall — the assertions can then pin exact balances.
 */

const checking: Account = {
  id: "chk",
  name: "Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 100000,
  basis: 100000,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const p529 = (value: number, growthRate = 0): Account => ({
  id: "p529",
  name: "529 College Fund",
  category: "taxable", // import paths classify 529 as taxable; subType drives tax-free
  subType: "529",
  titlingType: "jtwros",
  value,
  basis: value,
  growthRate,
  rmdEnabled: false,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
});

const eduExpense = (overrides: Partial<Expense>): Expense => ({
  id: "edu",
  type: "education",
  name: "College",
  annualAmount: 20000,
  startYear: 2026,
  endYear: 2026,
  growthRate: 0,
  dedicatedAccountIds: ["p529"],
  payShortfallOutOfPocket: false,
  ...overrides,
});

function makeData(accounts: Account[], expense: Expense, planEndYear = 2026) {
  const base = buildClientData({
    planSettings: { ...basePlanSettings, planStartYear: 2026, planEndYear },
  });
  return {
    ...base,
    accounts,
    incomes: [],
    expenses: [expense],
    liabilities: [],
    savingsRules: [],
    withdrawalStrategy: [],
  };
}

describe("applyEducationFunding", () => {
  it("draws a 529 for the goal, records educationGoals, stays tax-free", () => {
    const data = makeData([checking, p529(30000)], eduExpense({}));
    const years = runProjection(data);
    const y0 = years[0];

    const goal = y0.educationGoals?.find((g) => g.goalId === "edu");
    expect(goal).toBeDefined();
    expect(goal!.dedicatedAssetsBOY).toBe(30000);
    expect(goal!.goalExpense).toBe(20000);
    expect(goal!.dedicatedWithdrawal).toBe(20000);
    expect(goal!.shortfall).toBe(0);
    expect(goal!.dedicatedAssetsEOY).toBeCloseTo(10000, 6);
    // 529 draw is tax-free: no ordinary income booked under the goal source.
    expect(y0.taxDetail!.bySource["education:edu"]).toBeUndefined();
    // The 529 balance dropped by exactly the draw; checking is untouched.
    expect(y0.accountLedgers["p529"].endingValue).toBeCloseTo(10000, 6);
    expect(y0.accountLedgers["chk"].endingValue).toBeCloseTo(100000, 6);
  });

  it("caps at dedicated funds when out-of-pocket is off (shortfall, no extra household outflow)", () => {
    const data = makeData([checking, p529(5000)], eduExpense({}));
    const y0 = runProjection(data)[0];
    const goal = y0.educationGoals!.find((g) => g.goalId === "edu")!;

    expect(goal.dedicatedWithdrawal).toBe(5000);
    expect(goal.shortfall).toBe(15000);
    // Out-of-pocket off: household checking must NOT absorb the shortfall.
    expect(y0.accountLedgers["chk"].endingValue).toBeCloseTo(100000, 6);
  });

  it("spills the shortfall to household cash when out-of-pocket is on", () => {
    const data = makeData(
      [checking, p529(5000)],
      eduExpense({ payShortfallOutOfPocket: true }),
    );
    const y0 = runProjection(data)[0];
    const goal = y0.educationGoals!.find((g) => g.goalId === "edu")!;

    expect(goal.dedicatedWithdrawal).toBe(5000);
    expect(goal.shortfall).toBe(15000);
    // Checking paid the 15k out-of-pocket portion (100k − 15k).
    expect(y0.accountLedgers["chk"].endingValue).toBeCloseTo(85000, 0);
  });

  it("a non-529 taxable dedicated account books ordinary/cap-gains into the year's tax (ordering guard)", () => {
    // A taxable brokerage funding the goal recognizes capital gains on the draw.
    // This case only passes if the education pass runs BEFORE baselineTaxDetail
    // is snapshotted — a mis-ordered pass would drop it from the year's tax.
    const brokerage: Account = {
      id: "brk-edu",
      name: "Edu Brokerage",
      category: "taxable",
      subType: "brokerage",
      titlingType: "jtwros",
      value: 30000,
      basis: 0, // full gain: the entire draw is capital gains
      growthRate: 0,
      rmdEnabled: false,
      owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
    };
    const data = makeData(
      [checking, brokerage],
      eduExpense({ dedicatedAccountIds: ["brk-edu"] }),
    );
    const y0 = runProjection(data)[0];
    const goal = y0.educationGoals!.find((g) => g.goalId === "edu")!;

    expect(goal.dedicatedWithdrawal).toBe(20000);
    expect(goal.shortfall).toBe(0);
    // The full $20k draw is capital gains (basis 0) and must reach the tax detail.
    const src = y0.taxDetail!.bySource["education:edu"];
    expect(src).toBeDefined();
    expect(src!.type).toBe("capital_gains");
    expect(src!.amount).toBeCloseTo(20000, 6);
    expect(y0.taxDetail!.capitalGains).toBeGreaterThanOrEqual(20000);
  });

  it("appreciated 529: ledger entry basis is clamped to tracked basis (reconciliation identity)", () => {
    // value 30000 / basis 10000 — categorizeDraw's 529 branch returns
    // basisReturn === amount, so a $20k draw's basisReturn exceeds the tracked
    // basis. The ledger entry must book only what basisMap actually shed
    // (−10000), NOT −20000, or the asset-ledger drill-down reports the account
    // as non-reconciling (basisEoY − basisBoY ≠ Σ entry.basis).
    const appreciated529: Account = { ...p529(30000), basis: 10000 };
    const data = makeData([checking, appreciated529], eduExpense({}));
    const y0 = runProjection(data)[0];

    const led = y0.accountLedgers["p529"];
    const eduEntry = led.entries.find(
      (e) => e.sourceId === "edu" && e.category === "withdrawal",
    );
    expect(eduEntry).toBeDefined();
    // Clamped to basisBefore (10000) — not the full draw amount (20000).
    expect(eduEntry!.basis).toBeCloseTo(-10000, 6);
    expect(eduEntry!.basis).not.toBeCloseTo(-20000, 6);

    // Reconciliation identity build-asset-ledger enforces:
    // basisEoY − basisBoY === Σ entries[].basis
    const sumEntryBasis = led.entries.reduce((s, e) => s + (e.basis ?? 0), 0);
    expect((led.basisEoY ?? 0) - (led.basisBoY ?? 0)).toBeCloseTo(sumEntryBasis, 6);
  });
});
