import { describe, expect, it, vi } from "vitest";

// commitAccounts' owner-writing path calls validateOwnersTenant, which
// queries the real db. Stub only the tenant check — needed by the
// persistPartialCommit tests below, which run a real commitAccounts pass.
vi.mock("@/lib/ownership", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ownership")>();
  return { ...actual, validateOwnersTenant: vi.fn().mockResolvedValue(null) };
});

import { commitAccounts } from "../accounts";
import { markTabsCommitted, persistPartialCommit } from "../orchestrator";
import { presenceFromPayload, requiredCommitTabs } from "../../required-tabs";
import type { CommitContext } from "../types";
import type { ImportPayload } from "../../types";
import { callsForTable, makeFakeTx } from "../../__tests__/commit-test-helpers";

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

describe("markTabsCommitted completeness (regression: unreachable 'committed')", () => {
  it("flips to committed when every REQUIRED tab is committed, even with categories absent", async () => {
    // The walkthrough import: accounts + incomes + entities only.
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [{}] as ImportPayload["accounts"],
      incomes: [{}] as ImportPayload["incomes"],
      entities: [{}] as ImportPayload["entities"],
    };

    const required = requiredCommitTabs(presenceFromPayload(payload));
    expect(required).toEqual(["plan-basics", "accounts", "incomes", "entities"]);

    const fake = makeFakeTx();
    // No prior commits recorded for this import.
    fake.setSelectResult("client_imports", []);

    // Commit exactly the required tabs in one pass, as commitTabs would.
    const result = await markTabsCommitted(fake.tx, "imp-1", required, payload);

    expect(result.allTabsCommitted).toBe(true);
    expect(result.firstTimeAllCommitted).toBe(true);
  });

  it("does NOT flip when a required tab is still missing", async () => {
    // Required tabs are accounts + incomes, but only accounts commits here.
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [{}] as ImportPayload["accounts"],
      incomes: [{}] as ImportPayload["incomes"],
    };

    const required = requiredCommitTabs(presenceFromPayload(payload));
    expect(required).toEqual(["plan-basics", "accounts", "incomes"]);

    const fake = makeFakeTx();
    fake.setSelectResult("client_imports", []);

    const result = await markTabsCommitted(fake.tx, "imp-2", ["accounts"], payload);

    expect(result.allTabsCommitted).toBe(false);
    expect(result.firstTimeAllCommitted).toBe(false);
  });
});

// Task 7 fix round 1, IMPORTANT 1: a row-filtered commit must not stamp
// perTabCommittedAt or flip status — that would mark the WHOLE accounts tab
// committed after only one of N rows landed. But it MUST still persist
// payloadJson, because that's the only place linkCreated's new-row link
// survives; skipping it entirely (the "obvious" fix) would make a second
// partial commit of the same row insert a duplicate account.
describe("persistPartialCommit (a row-filtered commit skips completion, not persistence)", () => {
  const ctx: CommitContext = {
    clientId: "client-1",
    scenarioId: "scenario-1",
    orgId: "org-1",
    userId: "user-1",
  };

  it("writes payloadJson + updatedAt but NOT perTabCommittedAt/status/committedAt", async () => {
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [{ __rowId: "r1", name: "IRA", match: { kind: "new" } }] as ImportPayload["accounts"],
    };
    const fake = makeFakeTx();
    fake.setSelectResult("client_imports", []);

    const result = await persistPartialCommit(fake.tx, "imp-partial-1", payload);

    const updates = callsForTable(fake.calls, "client_imports").filter((c) => c.op === "update");
    expect(updates).toHaveLength(1);
    const values = (updates[0] as { values: Record<string, unknown> }).values;
    expect(values).toHaveProperty("payloadJson");
    expect(values).toHaveProperty("updatedAt");
    expect(values).not.toHaveProperty("perTabCommittedAt");
    expect(values).not.toHaveProperty("status");
    expect(values).not.toHaveProperty("committedAt");
    // A partial commit can never BE the transition to fully-committed —
    // closing the import belongs to the surface that knows committedRowIds
    // (Tasks 9/10), not this dispatcher.
    expect(result.firstTimeAllCommitted).toBe(false);
  });

  it("reports allTabsCommitted against the EXISTING state, not as if this call completed the tab", async () => {
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [{ __rowId: "r1", name: "IRA", match: { kind: "new" } }] as ImportPayload["accounts"],
    };
    const fake = makeFakeTx();
    // Every other required tab (plan-basics) is already committed; accounts
    // never has been — this partial commit must not change that.
    fake.setSelectResult("client_imports", [
      { perTabCommittedAt: { "plan-basics": "2026-01-01T00:00:00.000Z" }, committedAt: null },
    ]);

    const result = await persistPartialCommit(fake.tx, "imp-partial-2", payload);
    expect(result.allTabsCommitted).toBe(false);
    expect(result.firstTimeAllCommitted).toBe(false);
  });

  it("a second partial commit of the same row does not insert a duplicate account", async () => {
    const payload: ImportPayload = {
      ...emptyPayload(),
      accounts: [{ __rowId: "r1", name: "IRA", match: { kind: "new" } }] as ImportPayload["accounts"],
    };

    const first = makeFakeTx();
    first.setInsertId("accounts", "acct-1");
    first.setSelectResult("client_imports", []);
    const r1 = await commitAccounts(first.tx, payload, { ...ctx, rowIds: ["r1"] });
    expect(r1.created).toBe(1);

    // The orchestrator's partial-commit path runs after dispatch, same as
    // markTabsCommitted would for an unfiltered commit.
    await persistPartialCommit(first.tx, "imp-partial-3", payload);

    // The link must have survived persistPartialCommit untouched — proving
    // it didn't (say) reload/replace the payload from a stale read.
    expect(payload.accounts[0].match).toEqual({ kind: "exact", existingId: "acct-1" });
    // And persistPartialCommit must have actually issued the write that
    // would carry that link to the DB — the wrong fix ("skip persistence
    // entirely for a partial commit") would silently drop this UPDATE.
    const importUpdates = callsForTable(first.calls, "client_imports").filter((c) => c.op === "update");
    expect(importUpdates).toHaveLength(1);
    expect(importUpdates[0].values).toHaveProperty("payloadJson");

    const second = makeFakeTx();
    const r2 = await commitAccounts(second.tx, payload, { ...ctx, rowIds: ["r1"] });
    expect(r2.created).toBe(0);
    expect(callsForTable(second.calls, "accounts").filter((c) => c.op === "insert")).toHaveLength(0);
    expect(callsForTable(second.calls, "accounts").filter((c) => c.op === "update")).toHaveLength(1);
  });
});
