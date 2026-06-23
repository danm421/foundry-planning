import { describe, it, expect, vi, beforeEach } from "vitest";

const selectMock = vi.fn();
const insertGroupsMock = vi.fn();
const insertLeavesMock = vi.fn();

vi.mock("@/db/schema", () => ({ transactionCategories: { _name: "transaction_categories" } }));
vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a }));
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => selectMock() }) }) }),
    transaction: async (fn: (tx: unknown) => unknown) => {
      const tx = {
        insert: () => ({
          values: (rows: unknown) => ({
            returning: () => {
              const arr = rows as Array<{ slug: string; kind: string }>;
              if (arr[0]?.kind === "group") {
                insertGroupsMock(arr);
                return Promise.resolve(arr.map((r) => ({ id: `grp-${r.slug}`, slug: r.slug })));
              }
              insertLeavesMock(arr);
              return Promise.resolve(arr.map((r, i) => ({ id: `leaf-${i}` })));
            },
          }),
        }),
      };
      return fn(tx);
    },
  },
}));

import { ensureCategoriesSeeded } from "@/lib/portal/seed-categories";

beforeEach(() => {
  selectMock.mockReset();
  insertGroupsMock.mockReset();
  insertLeavesMock.mockReset();
});

describe("ensureCategoriesSeeded", () => {
  it("is a no-op when the client already has categories", async () => {
    selectMock.mockResolvedValue([{ id: "existing" }]);
    await ensureCategoriesSeeded("c1");
    expect(insertGroupsMock).not.toHaveBeenCalled();
    expect(insertLeavesMock).not.toHaveBeenCalled();
  });

  it("inserts all groups then all leaves with parentId wired when none exist", async () => {
    selectMock.mockResolvedValue([]);
    await ensureCategoriesSeeded("c1");
    expect(insertGroupsMock).toHaveBeenCalledTimes(1);
    expect(insertLeavesMock).toHaveBeenCalledTimes(1);
    const groups = insertGroupsMock.mock.calls[0][0] as Array<{ kind: string; isSystem: boolean; clientId: string }>;
    const leaves = insertLeavesMock.mock.calls[0][0] as Array<{ kind: string; parentId: string; slug: string }>;
    expect(groups.every((g) => g.kind === "group" && g.isSystem && g.clientId === "c1")).toBe(true);
    expect(leaves.every((l) => l.kind === "category" && l.parentId.startsWith("grp-"))).toBe(true);
    // a household leaf points at the household group id
    const mortgage = leaves.find((l) => l.slug === "household-mortgage");
    expect(mortgage?.parentId).toBe("grp-household");
  });
});
