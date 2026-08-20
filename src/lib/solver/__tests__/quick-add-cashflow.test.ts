// src/lib/solver/__tests__/quick-add-cashflow.test.ts
import { describe, it, expect } from "vitest";
import {
  addedQuickAddRows,
  blankCashflowDraft,
  cashflowRemoveMutation,
  cashflowUpsertMutation,
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

  it("carries an owner and a tax treatment for an income, neither for an expense", () => {
    // An expense has no household owner anywhere in the app, and no tax
    // treatment — both are income-only concepts.
    expect(blank("income").owner).toBe("client");
    expect(blank("income").taxType).toBe("ordinary_income");
    expect(blank("expense").owner).toBeUndefined();
    expect(blank("expense").taxType).toBeUndefined();
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

  it("mints the chosen tax treatment, and reads it back off the row", () => {
    const exempt = incomeFromDraft({ ...draft, taxType: "tax_exempt" });
    expect(exempt.taxType).toBe("tax_exempt");
    expect(draftFromIncome(exempt).taxType).toBe("tax_exempt");
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

describe("addedQuickAddRows", () => {
  const row = (id: string, type = "other") => ({ id, type });

  it("returns only working rows the source tree does not have", () => {
    expect(addedQuickAddRows([row("a")], [row("a"), row("b")])).toEqual([row("b")]);
  });

  it("ignores a row this popup could not have minted", () => {
    // A synthesized retirement living expense and an education goal both reach
    // the working tree through the same expense-upsert. A tree diff says WHAT
    // changed, never WHO changed it — so the type is what tells them apart.
    const added = addedQuickAddRows(
      [],
      [row("living", "living"), row("goal", "education"), row("mine")],
    );
    expect(added).toEqual([row("mine")]);
  });
});

describe("row mutations", () => {
  const income: CashflowDraft = { ...blank("income"), name: "Rental", annualAmount: 24_000 };

  it("commits a row as a FULL upsert on its own id", () => {
    // A field lever (income-annual-amount) is dropped by save-to-base's
    // source-membership guard for a row the plan has never seen.
    const m = cashflowUpsertMutation(income);
    expect(m).toEqual({
      kind: "income-upsert",
      id: "row-1",
      value: incomeFromDraft(income),
    });
    const e = cashflowUpsertMutation({ ...income, kind: "expense" });
    expect(e.kind).toBe("expense-upsert");
  });

  it("removes a row with a null upsert of the matching kind", () => {
    expect(cashflowRemoveMutation("income", "row-1")).toEqual({
      kind: "income-upsert",
      id: "row-1",
      value: null,
    });
    expect(cashflowRemoveMutation("expense", "row-1")).toEqual({
      kind: "expense-upsert",
      id: "row-1",
      value: null,
    });
  });
});
