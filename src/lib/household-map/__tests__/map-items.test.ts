import { describe, it, expect } from "vitest";
import {
  expenseToMapItem,
  flowAssignment,
  incomeToMapItem,
  isHydratableExpense,
  isHydratableIncome,
  resolveSavings,
} from "../map-items";
import type { ColumnContext } from "../types";
import type { Expense, Income, SavingsRule } from "@/engine/types";

const CLIENT_FM = "fm-client";

const ctx: ColumnContext = {
  roleByFamilyMemberId: new Map([[CLIENT_FM, "client"]] as const),
  nameByFamilyMemberId: new Map([[CLIENT_FM, "Dan"]]),
  nameByEntityId: new Map([["ent-1", "Sample Family Trust"]]),
};

/** Business-account name lookup — `flowAssignment` needs it to label a
 *  business-owned flow's tray card. Mirrors the `accountById` map the map route
 *  already builds for `savingsToMapItem`. */
const accountById = new Map([["acct-biz", { name: "Mueller Consulting LLC" }]]);

const income = (over: Partial<Income> = {}): Income => ({
  id: "inc-1",
  type: "salary",
  name: "Salary",
  annualAmount: 90000,
  startYear: 2026,
  endYear: 2045,
  growthRate: 0.03,
  owner: "client",
  ...over,
});

const savingsRule = (over: Partial<SavingsRule> = {}): SavingsRule => ({
  id: "rule-1",
  accountId: "acct-1",
  annualAmount: 6000,
  isDeductible: false,
  startYear: 2026,
  endYear: 2060,
  ...over,
});

describe("resolveSavings", () => {
  // Table over every branch of resolveSavings' resolution order, which mirrors
  // the engine's (engine/savings.ts resolveContributionAmount). Branch 3
  // (annualPercent === 0 falling through to the flat branch) is the one that
  // shipped as a real bug earlier on this branch — the guard is
  // `!= null && > 0`, not just `!= null`.
  it.each([
    [
      "scheduleOverrides wins over every other mode, including contributeMax",
      savingsRule({
        scheduleOverrides: { 2026: 20000, 2027: 21000 },
        contributeMax: true,
        annualPercent: 0.1,
        annualAmount: 9999,
      }),
      { value: 0, valueLabel: "Custom schedule" },
    ],
    [
      "an EMPTY scheduleOverrides is not a schedule — falls through",
      savingsRule({ scheduleOverrides: {}, annualAmount: 6000 }),
      { value: -6000, valueLabel: "($6,000)" },
    ],
    [
      "contributeMax true → IRS max label, zero value",
      savingsRule({ contributeMax: true, annualPercent: 0.1, annualAmount: 9999 }),
      { value: 0, valueLabel: "IRS max" },
    ],
    [
      "annualPercent set and > 0 → percent-of-pay label, zero value",
      savingsRule({ annualPercent: 0.08, annualAmount: 9999 }),
      { value: 0, valueLabel: "8% of pay" },
    ],
    [
      "annualPercent === 0 falls through to the flat branch (not '0% of pay')",
      savingsRule({ annualPercent: 0, annualAmount: 6000 }),
      { value: -6000, valueLabel: "($6,000)" },
    ],
    [
      "flat annualAmount → negative value (savings is an outflow)",
      savingsRule({ annualAmount: 6000 }),
      { value: -6000, valueLabel: "($6,000)" },
    ],
  ] as const)("%s", (_label, rule, expected) => {
    expect(resolveSavings(rule)).toEqual(expected);
  });

  it("renders a zero flat annualAmount as $0, not -$0", () => {
    // -0 must hit moneyLabel's `value === 0 ? 0 : value` guard.
    expect(resolveSavings(savingsRule({ annualAmount: 0 }))).toEqual({
      value: -0,
      valueLabel: "$0",
    });
  });
});

describe("flowAssignment", () => {
  it("trays an entity-owned flow with the entity's name", () => {
    const r = flowAssignment({ ownerEntityId: "ent-1" }, "joint", accountById, ctx);
    expect(r).toEqual({ column: "tray", splitChip: null, trayOwnerLabel: "Sample Family Trust" });
  });

  it("falls back to 'Entity-owned' when the entity id isn't in nameByEntityId", () => {
    const r = flowAssignment({ ownerEntityId: "ent-unknown" }, "joint", accountById, ctx);
    expect(r).toEqual({ column: "tray", splitChip: null, trayOwnerLabel: "Entity-owned" });
  });

  // Business-owned rows reach household cash ONLY through the business's
  // distribution sweep (engine/projection.ts), so drawing the raw amount in a
  // principal's column double-counts it against the distribution the engine
  // actually reports — the same reason income-expenses-view excludes
  // ownerAccountId rows from its household totals.
  it("trays a business-account-owned flow with the business account's name", () => {
    const r = flowAssignment({ ownerAccountId: "acct-biz" }, "client", accountById, ctx);
    expect(r).toEqual({ column: "tray", splitChip: null, trayOwnerLabel: "Mueller Consulting LLC" });
  });

  it("falls back to 'Business-owned' when the account id isn't in accountById", () => {
    const r = flowAssignment({ ownerAccountId: "acct-gone" }, "client", accountById, ctx);
    expect(r).toEqual({ column: "tray", splitChip: null, trayOwnerLabel: "Business-owned" });
  });

  it("prefers the entity label when a row carries both owners", () => {
    const r = flowAssignment(
      { ownerEntityId: "ent-1", ownerAccountId: "acct-biz" },
      "joint",
      accountById,
      ctx,
    );
    expect(r.trayOwnerLabel).toBe("Sample Family Trust");
  });

  it("uses the household column when there is no non-household owner", () => {
    const r = flowAssignment({}, "joint", accountById, ctx);
    expect(r).toEqual({ column: "joint", splitChip: null, trayOwnerLabel: null });
  });
});

describe("incomeToMapItem", () => {
  it("places a household income in its owner's column", () => {
    expect(incomeToMapItem(income(), accountById, ctx).column).toBe("client");
  });

  // $200k of S-corp gross revenue in the Joint column, while
  // /details/income-expenses shows only the $80k distribution, is a $120k gap
  // where the Map's number is the one the engine does NOT use.
  it("trays business-account-owned revenue instead of counting it as the owner's income", () => {
    const item = incomeToMapItem(
      income({ type: "business", name: "S-corp revenue", ownerAccountId: "acct-biz" }),
      accountById,
      ctx,
    );
    expect(item.column).toBe("tray");
    expect(item.trayOwnerLabel).toBe("Mueller Consulting LLC");
  });
});

describe("editor hydration eligibility", () => {
  // These two predicates decide which rows land in
  // `HouseholdMapProps.incomeRows` / `.expenseRows`, and a hydration entry is
  // the ONLY thing that makes a Map card clickable (`isItemEditable` in
  // household-map-view.tsx). Excluding a row here is a data-loss guard, not a
  // cosmetic one — see the doc comments on the predicates.
  it("admits an ordinary salary income", () => {
    expect(isHydratableIncome(income())).toBe(true);
  });

  // THE MERGE GATE. The drawer submits a fixed nine-key `desiredFields` and the
  // scenario changes-writer replaces the payload wholesale, so a no-op Save on
  // an SS card inside a "claim at 70" scenario would empty the diff and DELETE
  // that scenario's edit row — silently reverting the claiming age and moving
  // the projection, Monte Carlo and solver with it. SS carries claimingAge,
  // claimingAgeMonths, claimingAgeMode, piaMonthly and ssBenefitMode, none of
  // which the drawer renders.
  it("EXCLUDES a social_security income — the drawer cannot round-trip its off-form fields", () => {
    expect(isHydratableIncome(income({ type: "social_security", name: "Alex's SS" }))).toBe(false);
  });

  it("excludes a synthesized policy income (no DB row for any write path to hit)", () => {
    expect(isHydratableIncome(income({ id: "policy-income-abc", source: "policy" }))).toBe(false);
  });

  it("excludes a synthesized policy premium on the expense side", () => {
    expect(isHydratableExpense({ source: "policy" })).toBe(false);
  });

  it("admits an ordinary expense — the SS carve-out is income-only", () => {
    expect(isHydratableExpense({ source: undefined })).toBe(true);
  });
});

describe("expenseToMapItem", () => {
  const expense = (over: Partial<Expense> = {}): Expense => ({
    id: "exp-1",
    type: "living",
    name: "Groceries",
    annualAmount: 12000,
    startYear: 2026,
    endYear: 2060,
    growthRate: 0.02,
    ...over,
  });

  it("carries a negative value since expenses are outflows", () => {
    const item = expenseToMapItem(expense({ annualAmount: 12000 }), accountById, ctx);
    expect(item.value).toBe(-12000);
    expect(item.valueLabel).toBe("($12,000)");
  });

  it("adds a 'for {name}' noteChip when forFamilyMemberId resolves", () => {
    const item = expenseToMapItem(expense({ forFamilyMemberId: CLIENT_FM }), accountById, ctx);
    expect(item.noteChip).toBe("for Dan");
  });

  // `debt` maps to --color-crit, the app's ERROR red. A groceries card wearing
  // it reads as an alert; only liabilities are debt.
  it("gives an ordinary living expense the household hue, not the error-red debt hue", () => {
    expect(expenseToMapItem(expense({ type: "living" }), accountById, ctx).category).toBe(
      "household",
    );
  });

  it("keeps insurance expenses on the insurance hue", () => {
    expect(expenseToMapItem(expense({ type: "insurance" }), accountById, ctx).category).toBe(
      "insurance",
    );
  });

  it("has a null noteChip when there is no forFamilyMemberId", () => {
    const item = expenseToMapItem(expense(), accountById, ctx);
    expect(item.noteChip).toBeNull();
  });
});
