import { describe, expect, it } from "vitest";
import { replaceSalaryIncomes } from "../salary-basis-incomes";

function fakeTx() {
  const inserted: unknown[] = [];
  const deleted: unknown[] = [];
  // Ordered log of every write. Call counts alone cannot catch an insert-before-delete
  // swap, which would silently wipe the rows it just wrote.
  const calls: string[] = [];
  return {
    inserted,
    deleted,
    calls,
    delete: () => ({
      where: (w: unknown) => { calls.push("delete"); deleted.push(w); return Promise.resolve(); },
    }),
    insert: () => ({
      values: (v: unknown) => { calls.push("insert"); inserted.push(v); return Promise.resolve(); },
    }),
  };
}

describe("replaceSalaryIncomes", () => {
  it("writes one row per income, in draw order", async () => {
    const tx = fakeTx();
    await replaceSalaryIncomes(tx as never, "rule-1", ["inc-b", "inc-a"]);
    expect(tx.inserted[0]).toEqual([
      { savingsRuleId: "rule-1", incomeId: "inc-b", sortOrder: 0 },
      { savingsRuleId: "rule-1", incomeId: "inc-a", sortOrder: 1 },
    ]);
  });

  it("deletes existing rows before inserting", async () => {
    const tx = fakeTx();
    await replaceSalaryIncomes(tx as never, "rule-1", ["inc-a"]);
    expect(tx.calls).toEqual(["delete", "insert"]);
  });

  it("deletes and inserts nothing more when the list is empty", async () => {
    const tx = fakeTx();
    await replaceSalaryIncomes(tx as never, "rule-1", []);
    expect(tx.calls).toEqual(["delete"]);
    expect(tx.inserted).toHaveLength(0);
  });

  it("drops a repeated income id, keeping its first position", async () => {
    // A repeat is doubly wrong: the table's UNIQUE(savings_rule_id, income_id)
    // turns it into a 500, and if one ever reached the engine, projection.ts's
    // `salaryIncomeIds.reduce` would add that salary in twice.
    const tx = fakeTx();
    await replaceSalaryIncomes(tx as never, "rule-1", ["inc-a", "inc-b", "inc-a"]);
    expect(tx.inserted[0]).toEqual([
      { savingsRuleId: "rule-1", incomeId: "inc-a", sortOrder: 0 },
      { savingsRuleId: "rule-1", incomeId: "inc-b", sortOrder: 1 },
    ]);
  });
});
