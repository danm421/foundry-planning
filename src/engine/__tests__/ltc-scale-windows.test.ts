import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, sampleAccounts, sampleExpenses } from "./fixtures";
import { absorbingLivingRow } from "../surplus-spend";
import { LEGACY_FM_CLIENT } from "../ownership";
import type { Account, ClientData, Expense, ProjectionYear } from "../types";

// The shared fixture has no default checking account, so household expense
// debits post to no ledger at all and a "no debit" assertion would pass
// vacuously. Give the household a checking account to debit.
const checking: Account = {
  id: "acct-checking",
  name: "Joint Checking",
  category: "cash",
  subType: "checking",
  titlingType: "jtwros",
  value: 10_000,
  basis: 10_000,
  growthRate: 0,
  rmdEnabled: false,
  isDefaultChecking: true,
  owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
};

const household = (overrides?: Partial<ClientData>) =>
  buildClientData({ accounts: [...sampleAccounts, checking], ...overrides });

/** Every household-ledger posting of the sample living row in `year`. The
 *  label is the cash-routing loop's `Expense: ${exp.name}`. */
const livingDebits = (y: ProjectionYear) =>
  Object.values(y.accountLedgers).flatMap((l) =>
    l.entries.filter((en) => en.label === "Expense: Living Expenses"),
  );

const withLivingWindow = (factor: number): Expense[] =>
  sampleExpenses.map((e) =>
    e.type === "living" ? { ...e, scaleWindows: [{ startYear: 2030, endYear: 2030, factor }] } : e,
  );

describe("scale windows through the projection", () => {
  it("the household is not debited for a cut-to-zero living expense", () => {
    const expenses = withLivingWindow(0);
    const years = runProjection(household({ expenses }));
    const y2030 = years.find((y) => y.year === 2030)!;
    expect(y2030.expenses.living).toBe(0);
    // The cash-routing seam: no living-expense debit on any account ledger.
    expect(livingDebits(y2030)).toEqual([]);
    // Control: the same filter does find the debit outside the cut, so the
    // empty match above is not a label that never matches.
    const y2031 = years.find((y) => y.year === 2031)!;
    expect(livingDebits(y2031)).toHaveLength(1);
    expect(livingDebits(y2031)[0].amount).toBeCloseTo(-y2031.expenses.living, 6);
  });

  it("an absorbing living row stops absorbing in a cut year", () => {
    const row: Expense = {
      ...sampleExpenses[0],
      absorbsRemainingCashFlow: true,
      scaleWindows: [{ startYear: 2030, endYear: 2030, factor: 0.5 }],
    };
    expect(absorbingLivingRow([row], 2029, buildClientData().client)?.id).toBe(row.id);
    expect(absorbingLivingRow([row], 2030, buildClientData().client)).toBeNull();
  });

  it("stacks with the higher-inflation stress: the cut scales the override-inflated amount", () => {
    const OVERRIDE = 0.1;
    const planSettings = { ...basePlanSettings, livingExpenseInflationOverride: OVERRIDE };
    const stressOnly = runProjection(household({ planSettings }));
    const stressAndCut = runProjection(
      household({ planSettings, expenses: withLivingWindow(0.5) }),
    );
    const at = (rows: ProjectionYear[], year: number) => rows.find((r) => r.year === year)!;

    // exp-living: $80k from 2026; the override compounds it at 10%, not 3%.
    const inflated2030 = 80_000 * Math.pow(1 + OVERRIDE, 4);
    expect(at(stressOnly, 2030).expenses.living).toBeCloseTo(inflated2030, 4);

    // Cut year: exactly half of the override-inflated amount, in the breakdown
    // AND in the cash actually debited.
    expect(at(stressAndCut, 2030).expenses.living).toBeCloseTo(
      at(stressOnly, 2030).expenses.living * 0.5,
      6,
    );
    expect(at(stressAndCut, 2030).expenses.living).toBeCloseTo(inflated2030 * 0.5, 4);
    expect(livingDebits(at(stressAndCut, 2030))).toHaveLength(1);
    expect(livingDebits(at(stressAndCut, 2030))[0].amount).toBeCloseTo(-inflated2030 * 0.5, 4);

    // The year after: back to the full override-inflated amount.
    expect(at(stressAndCut, 2031).expenses.living).toBeCloseTo(
      at(stressOnly, 2031).expenses.living,
      6,
    );
    expect(at(stressAndCut, 2031).expenses.living).toBeCloseTo(80_000 * Math.pow(1 + OVERRIDE, 5), 4);
  });
});
