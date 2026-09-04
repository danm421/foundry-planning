import { describe, it, expect, vi, beforeEach } from "vitest";

const { selectWhere, insertConflict, deleteWhere } = vi.hoisted(() => ({
  selectWhere: vi.fn(), insertConflict: vi.fn(), deleteWhere: vi.fn(),
}));
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: selectWhere }) }),
    insert: () => ({ values: () => ({ onConflictDoNothing: insertConflict }) }),
    delete: () => ({ where: deleteWhere }),
  },
}));

import { listDismissedIds, addDismissal, removeDismissal } from "../dismissals-store";

// Drizzle wraps driver errors: the Postgres code sits on `.cause`, never `.code`.
const undefinedTable = () =>
  Object.assign(new Error("query failed"), { cause: { code: "42P01" } });

describe("dismissals-store", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists the dismissed suggestion ids for a return", async () => {
    selectWhere.mockResolvedValue([{ suggestionId: "income.wages.w2.0" }, { suggestionId: "tax.federal" }]);
    const r = await listDismissedIds("tr-1");
    expect(r).toEqual({ ok: true, ids: new Set(["income.wages.w2.0", "tax.federal"]) });
  });

  it("degrades to unavailable when the table is not migrated yet", async () => {
    selectWhere.mockRejectedValue(undefinedTable());
    expect(await listDismissedIds("tr-1")).toEqual({ ok: false, unavailable: true });
  });

  it("rethrows any other database error", async () => {
    selectWhere.mockRejectedValue(Object.assign(new Error("connection terminated"), { cause: { code: "57P01" } }));
    await expect(listDismissedIds("tr-1")).rejects.toThrow("connection terminated");
  });

  it("adds idempotently and reports unavailable in the migration window", async () => {
    insertConflict.mockResolvedValue(undefined);
    expect(await addDismissal("tr-1", "tax.federal", "user_1")).toBe("ok");
    insertConflict.mockRejectedValue(undefinedTable());
    expect(await addDismissal("tr-1", "tax.federal", "user_1")).toBe("unavailable");
  });

  it("removes and reports unavailable in the migration window", async () => {
    deleteWhere.mockResolvedValue(undefined);
    expect(await removeDismissal("tr-1", "tax.federal")).toBe("ok");
    deleteWhere.mockRejectedValue(undefinedTable());
    expect(await removeDismissal("tr-1", "tax.federal")).toBe("unavailable");
  });
});
