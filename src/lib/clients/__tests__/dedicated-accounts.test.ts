import { describe, expect, it, vi } from "vitest";
import { replaceDedicatedAccounts } from "../dedicated-accounts";

function fakeTx() {
  const inserted: unknown[] = [];
  const deleted: unknown[] = [];
  return {
    inserted,
    deleted,
    delete: () => ({ where: (w: unknown) => { deleted.push(w); return Promise.resolve(); } }),
    insert: () => ({ values: (v: unknown) => { inserted.push(v); return Promise.resolve(); } }),
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
    expect(tx.deleted).toHaveLength(1);
  });

  it("deletes and inserts nothing more when the list is empty", async () => {
    const tx = fakeTx();
    await replaceDedicatedAccounts(tx as never, "exp-1", []);
    expect(tx.deleted).toHaveLength(1);
    expect(tx.inserted).toHaveLength(0);
  });
});
