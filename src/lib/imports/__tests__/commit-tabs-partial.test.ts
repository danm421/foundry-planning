/**
 * Task 7 fix round 1, IMPORTANT 1: proves `commitTabs` itself — not just the
 * leaf `persistPartialCommit` function — routes to the partial-commit path
 * when `ctx.rowIds` is set, and to the ordinary `markTabsCommitted` path
 * (byte-for-byte unchanged) when it is absent. `commit/__tests__/
 * orchestrator.test.ts` already pins `persistPartialCommit`'s own behavior
 * in isolation; a regression in the dispatcher's branching (e.g. someone
 * reverting the `isPartialCommit` check) would slip past that file
 * entirely, which is what this test exists to catch.
 */
import { describe, expect, it, vi } from "vitest";
import type { FakeTx } from "./commit-test-helpers";

vi.mock("@/lib/ownership", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ownership")>();
  return { ...actual, validateOwnersTenant: vi.fn().mockResolvedValue(null) };
});

// A fresh fake transaction on every `db.transaction` call, captured on
// `mockLastFake` (the `mock` prefix is required for vitest's hoisted
// `vi.mock` factory to reference an outer-scope binding). Fresh-per-call
// means each `commitTabs()` invocation below gets its own clean set of
// recorded calls, so insert/update-count assertions are never polluted by
// a sibling test or an earlier call in the same test.
let mockLastFake: FakeTx | undefined;
vi.mock("@/db", async () => {
  const { makeFakeTx } = await import("./commit-test-helpers");
  return {
    db: {
      transaction: async <T,>(fn: (tx: unknown) => Promise<T>) => {
        const fake = makeFakeTx();
        mockLastFake = fake;
        return fn(fake.tx);
      },
    },
  };
});

import { commitTabs } from "@/lib/imports/commit/orchestrator";
import type { ImportPayload } from "@/lib/imports/types";
import { callsForTable } from "./commit-test-helpers";

const ctx = {
  clientId: "client-1",
  scenarioId: "scenario-1",
  orgId: "org-1",
  userId: "user-1",
};

function emptyPayload(): ImportPayload {
  return {
    dependents: [],
    accounts: [],
    incomes: [],
    expenses: [],
    liabilities: [],
    lifePolicies: [],
    wills: [],
    entities: [],
    savings: [],
    warnings: [],
  };
}

describe("commitTabs routes to the partial-commit path only when ctx.rowIds is set", () => {
  it("an unfiltered commit still stamps perTabCommittedAt (today's behaviour, unchanged)", async () => {
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [{ __rowId: "r1", name: "IRA", match: { kind: "new" } }] as ImportPayload["accounts"],
    };
    mockLastFake = undefined;

    const { allTabsCommitted } = await commitTabs({
      importId: "imp-unfiltered",
      payload,
      // plan-basics is always required regardless of payload contents; it
      // no-ops when payload.planBasics is unset but still stamps its own
      // perTabCommittedAt entry. Committing it alongside accounts completes
      // the required set for this minimal payload.
      tabs: ["plan-basics", "accounts"],
      ctx,
    });

    expect(allTabsCommitted).toBe(true);
    const updates = callsForTable(mockLastFake!.calls, "client_imports").filter((c) => c.op === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toHaveProperty("perTabCommittedAt");
  });

  it("a row-filtered commit does NOT stamp perTabCommittedAt, even though the same tab would otherwise complete", async () => {
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [{ __rowId: "r1", name: "IRA", match: { kind: "new" } }] as ImportPayload["accounts"],
    };
    mockLastFake = undefined;

    const { allTabsCommitted, firstTimeAllCommitted } = await commitTabs({
      importId: "imp-partial",
      payload,
      tabs: ["accounts"],
      ctx: { ...ctx, rowIds: ["r1"] },
    });

    expect(allTabsCommitted).toBe(false);
    expect(firstTimeAllCommitted).toBe(false);
    const updates = callsForTable(mockLastFake!.calls, "client_imports").filter((c) => c.op === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0].values).not.toHaveProperty("perTabCommittedAt");
    expect(updates[0].values).not.toHaveProperty("status");
    // Still persisted, so the linkCreated link this pass just stamped onto
    // the payload survives to the next commit.
    expect(updates[0].values).toHaveProperty("payloadJson");
  });
});
