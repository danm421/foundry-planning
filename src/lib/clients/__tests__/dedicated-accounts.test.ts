import { describe, expect, it } from "vitest";
import { replaceDedicatedAccounts } from "../dedicated-accounts";

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

describe("replaceDedicatedAccounts", () => {
  it("writes one row per account, in draw order", async () => {
    const tx = fakeTx();
    await replaceDedicatedAccounts(tx as never, "exp-1", ["acct-a", "acct-b"]);
    expect(tx.inserted[0]).toEqual([
      { expenseId: "exp-1", accountId: "acct-a", sortOrder: 0 },
      { expenseId: "exp-1", accountId: "acct-b", sortOrder: 1 },
    ]);
  });

  it("deletes existing rows before inserting", async () => {
    const tx = fakeTx();
    await replaceDedicatedAccounts(tx as never, "exp-1", ["acct-a"]);
    expect(tx.calls).toEqual(["delete", "insert"]);
  });

  it("deletes and inserts nothing more when the list is empty", async () => {
    const tx = fakeTx();
    await replaceDedicatedAccounts(tx as never, "exp-1", []);
    expect(tx.calls).toEqual(["delete"]);
    expect(tx.inserted).toHaveLength(0);
  });
});
