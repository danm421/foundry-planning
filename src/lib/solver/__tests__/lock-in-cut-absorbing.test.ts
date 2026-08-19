import { describe, it, expect } from "vitest";
import { buildLockInCutMutations } from "@/lib/solver/lock-in-cut";
import type { Expense } from "@/engine/types";

const row = (over: Partial<Expense> & { id: string }): Expense => ({
  type: "living", name: "Current Living Expenses", annualAmount: 100_000,
  startYear: 2020, endYear: 2040, growthRate: 0, ...over,
});

describe("buildLockInCutMutations with an absorbing row", () => {
  it("never cuts an absorbing row", () => {
    const out = buildLockInCutMutations(
      [row({ id: "e1", absorbsRemainingCashFlow: true })], 2026, 2026, 10_000,
    );
    expect(out).toEqual([]);
  });

  it("still cuts a normal living row beside an absorbing one", () => {
    const out = buildLockInCutMutations(
      [row({ id: "e1", absorbsRemainingCashFlow: true }),
       row({ id: "e2", annualAmount: 50_000 })],
      2026, 2026, 10_000,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ expenseId: "e2", annualAmount: 40_000 });
  });
});
