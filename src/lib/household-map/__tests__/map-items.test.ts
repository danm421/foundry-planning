import { describe, it, expect } from "vitest";
import {
  expenseToMapItem,
  flowAssignment,
  resolveSavings,
} from "../map-items";
import type { ColumnContext } from "../types";
import type { Expense, SavingsRule } from "@/engine/types";

const CLIENT_FM = "fm-client";

const ctx: ColumnContext = {
  roleByFamilyMemberId: new Map([[CLIENT_FM, "client"]] as const),
  nameByFamilyMemberId: new Map([[CLIENT_FM, "Dan"]]),
  nameByEntityId: new Map([["ent-1", "Sample Family Trust"]]),
};

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
  // Table over all four branches of resolveSavings' resolution order
  // (scheduleOverrides is a separate, untracked-here gap — see the doc
  // comment on resolveSavings in map-items.ts). Branch 3 (annualPercent
  // === 0 falling through to the flat branch) is the one that shipped as
  // a real bug earlier on this branch — the guard is `!= null && > 0`,
  // not just `!= null`.
  it.each([
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
    const r = flowAssignment("ent-1", "joint", ctx);
    expect(r).toEqual({ column: "tray", splitChip: null, trayOwnerLabel: "Sample Family Trust" });
  });

  it("falls back to 'Entity-owned' when the entity id isn't in nameByEntityId", () => {
    const r = flowAssignment("ent-unknown", "joint", ctx);
    expect(r).toEqual({ column: "tray", splitChip: null, trayOwnerLabel: "Entity-owned" });
  });

  it("uses the household column when there is no owning entity", () => {
    const r = flowAssignment(undefined, "joint", ctx);
    expect(r).toEqual({ column: "joint", splitChip: null, trayOwnerLabel: null });
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
    const item = expenseToMapItem(expense({ annualAmount: 12000 }), ctx);
    expect(item.value).toBe(-12000);
    expect(item.valueLabel).toBe("($12,000)");
  });

  it("adds a 'for {name}' noteChip when forFamilyMemberId resolves", () => {
    const item = expenseToMapItem(expense({ forFamilyMemberId: CLIENT_FM }), ctx);
    expect(item.noteChip).toBe("for Dan");
  });

  it("has a null noteChip when there is no forFamilyMemberId", () => {
    const item = expenseToMapItem(expense(), ctx);
    expect(item.noteChip).toBeNull();
  });
});
