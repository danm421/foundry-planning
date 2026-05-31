import { describe, it, expect, vi } from "vitest";

// Mock drizzle's eq() to a tiny tagged value our in-memory tx stub can read,
// and the schema to just the column the helper references. Self-contained
// factories (no outer-scope refs) so vitest can hoist them above the import.
vi.mock("drizzle-orm", () => ({
  eq: (_col: unknown, val: string) => ({ __targetId: val }),
}));
vi.mock("@/db/schema", () => ({
  scenarioChanges: { targetId: { __col: "target_id" } },
}));

import { pruneOrphanScenarioChanges } from "../prune-changes";

/** In-memory stand-in for a Drizzle transaction handle. */
function makeTx(rows: Array<{ targetId: string }>) {
  return {
    delete: () => ({
      where: (pred: { __targetId: string }) => {
        for (let i = rows.length - 1; i >= 0; i--) {
          if (rows[i].targetId === pred.__targetId) rows.splice(i, 1);
        }
        return Promise.resolve();
      },
    }),
  };
}

describe("pruneOrphanScenarioChanges (F18)", () => {
  it("deletes rows whose targetId matches the deleted id", async () => {
    const rows = [{ targetId: "a1" }, { targetId: "a1" }, { targetId: "b2" }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pruneOrphanScenarioChanges(makeTx(rows) as any, "a1");
    expect(rows).toEqual([{ targetId: "b2" }]);
  });

  it("leaves non-matching rows intact", async () => {
    const rows = [{ targetId: "b2" }, { targetId: "c3" }];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pruneOrphanScenarioChanges(makeTx(rows) as any, "a1");
    expect(rows).toEqual([{ targetId: "b2" }, { targetId: "c3" }]);
  });

  it("is a no-op when no rows match", async () => {
    const rows = [{ targetId: "b2" }];
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pruneOrphanScenarioChanges(makeTx(rows) as any, "missing"),
    ).resolves.toBeUndefined();
    expect(rows).toEqual([{ targetId: "b2" }]);
  });
});
