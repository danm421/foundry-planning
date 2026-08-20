// src/lib/solver/__tests__/quick-add-cashflow.test.ts
import { describe, it, expect } from "vitest";
import {
  blankCashflowDraft,
  draftFromExpense,
  draftFromIncome,
  expenseFromDraft,
  incomeFromDraft,
  isQuickAddCashflowRow,
  type CashflowDraft,
} from "@/lib/solver/quick-add-cashflow";
import type { ClientMilestones } from "@/lib/milestones";
import type { Income, Expense } from "@/engine/types";

const milestones: ClientMilestones = {
  planStart: 2026,
  planEnd: 2061,
  clientRetirement: 2045,
  clientEnd: 2061,
};

const blank = (kind: "income" | "expense") =>
  blankCashflowDraft({
    kind,
    id: "row-1",
    owner: "client",
    milestones,
    inflationRate: 0.03,
  });

describe("blankCashflowDraft", () => {
  it("anchors both years to milestones, matching every other add-row surface", () => {
    // defaultIncomeRefs("other", …) / defaultExpenseRefs("other") both give
    // plan_start → plan_end. A literal current year would never track the plan.
    for (const kind of ["income", "expense"] as const) {
      const d = blank(kind);
      expect(d.startYearRef).toBe("plan_start");
      expect(d.endYearRef).toBe("plan_end");
      expect(d.startYear).toBe(2026);
      expect(d.endYear).toBe(2061);
    }
  });

  it("defaults growth to plan inflation", () => {
    const d = blank("income");
    expect(d.growthSource).toBe("inflation");
    expect(d.growthRate).toBe(0.03);
  });

  it("carries an owner for an income and none for an expense", () => {
    expect(blank("income").owner).toBe("client");
    expect(blank("expense").owner).toBeUndefined();
  });
});

describe("row builders", () => {
  const draft: CashflowDraft = { ...blank("income"), name: "Rental", annualAmount: 24_000 };

  it("mints an income as a plain ordinary-income household stream", () => {
    const i = incomeFromDraft(draft);
    expect(i.type).toBe("other");
    expect(i.taxType).toBe("ordinary_income");
    expect(i.source).toBe("manual");
    expect(i.owner).toBe("client");
    expect(i.annualAmount).toBe(24_000);
  });

  it("mints an expense as 'other', never 'living'", () => {
    // A living row beginning after plan start is swept into the
    // living-expense-scale solve lever (isRetirementLivingExpense).
    expect(expenseFromDraft({ ...draft, kind: "expense" }).type).toBe("other");
  });

  it("round-trips an income through draft and back unchanged", () => {
    const i = incomeFromDraft(draft);
    expect(incomeFromDraft(draftFromIncome(i))).toEqual(i);
  });

  it("round-trips an expense through draft and back unchanged", () => {
    const e = expenseFromDraft({ ...draft, kind: "expense" });
    expect(expenseFromDraft(draftFromExpense(e))).toEqual(e);
  });

  it("reads a stored custom growth source back as custom", () => {
    const stored = { ...incomeFromDraft(draft), growthSource: "custom" } as Income;
    expect(draftFromIncome(stored).growthSource).toBe("custom");
  });
});

describe("isQuickAddCashflowRow", () => {
  it("accepts only the type this popup mints", () => {
    expect(isQuickAddCashflowRow({ type: "other" })).toBe(true);
    for (const type of ["living", "education", "insurance", "salary", "social_security"]) {
      expect(isQuickAddCashflowRow({ type })).toBe(false);
    }
  });

  it("rejects a synthesized retirement living expense", () => {
    const synthesized = { id: "x", type: "living" } as unknown as Expense;
    expect(isQuickAddCashflowRow(synthesized)).toBe(false);
  });
});
