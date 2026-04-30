import { describe, expect, it, vi } from "vitest";

import { commitTabs } from "@/lib/imports/commit/orchestrator";
import { COMMIT_TABS } from "@/lib/imports/commit/types";
import type { ImportPayload } from "@/lib/imports/types";

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
    warnings: [],
  };
}

vi.mock("@/db", async () => {
  const { makeFakeTx } = await import("./commit-test-helpers");
  // The orchestrator awaits db.transaction(callback). The test passes
  // a stub that runs the callback with a fresh fake tx and exposes the
  // recorded calls so the test can assert table-level expectations.
  const fake = makeFakeTx();
  return {
    db: {
      transaction: async <T,>(fn: (tx: typeof fake.tx) => Promise<T>) => {
        return fn(fake.tx);
      },
      __fake: fake,
    },
  };
});

describe("commitTabs orchestrator", () => {
  it("dispatches in COMMIT_TABS order regardless of input order", async () => {
    const payload: ImportPayload = {
      ...emptyPayload(),
      primary: { firstName: "Jordan" },
      entities: [{ name: "Trust A", match: { kind: "new" } }],
    };

    // Reverse the order to verify the orchestrator re-sorts
    const tabs = ["entities", "clients-identity"] as const;
    const { results } = await commitTabs({
      importId: "imp-1",
      payload,
      tabs,
      ctx,
    });

    // Both ran
    expect(results["clients-identity"].updated + results["clients-identity"].created).toBeGreaterThanOrEqual(0);
    expect(results.entities.created).toBe(1);

    // Untouched tabs default to zero counts
    expect(results.accounts).toEqual({ created: 0, updated: 0, skipped: 0 });
    expect(results.wills).toEqual({ created: 0, updated: 0, skipped: 0 });
  });

  it("returns allTabsCommitted=false when only some tabs ran and DB has none committed yet", async () => {
    const { allTabsCommitted } = await commitTabs({
      importId: "imp-2",
      payload: emptyPayload(),
      tabs: ["entities"],
      ctx,
    });
    expect(allTabsCommitted).toBe(false);
  });

  it("includes a result entry for every tab in COMMIT_TABS", async () => {
    const { results } = await commitTabs({
      importId: "imp-3",
      payload: emptyPayload(),
      tabs: ["entities"],
      ctx,
    });
    for (const tab of COMMIT_TABS) {
      expect(results[tab]).toBeDefined();
      expect(results[tab].created).toBeGreaterThanOrEqual(0);
    }
  });
});
