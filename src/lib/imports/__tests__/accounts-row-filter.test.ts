/**
 * Per-row commit (Task 7). The chat surface lets an advisor commit specific
 * rows rather than a whole tab, via `ctx.rowIds` filtering on
 * `Annotated.__rowId` (Task 6). Only `commitAccounts` honours it today (C3)
 * — every other commit module ignores it, which is proven below with
 * `commitIncomes`.
 */
import { describe, expect, it, vi } from "vitest";

// commitAccounts' owner-writing path calls validateOwnersTenant, which
// queries the real db. Stub only the tenant check so this stays a pure unit
// test — mirrors commit-modules.test.ts's setup exactly.
vi.mock("@/lib/ownership", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ownership")>();
  return { ...actual, validateOwnersTenant: vi.fn().mockResolvedValue(null) };
});

import { commitAccounts } from "@/lib/imports/commit/accounts";
import { commitIncomes } from "@/lib/imports/commit/incomes";
import type { CommitContext } from "@/lib/imports/commit/types";
import { emptyImportPayload, type ImportPayload } from "@/lib/imports/types";

import { callsForTable, makeFakeTx } from "./commit-test-helpers";

const ctx: CommitContext = {
  clientId: "client-1",
  scenarioId: "scenario-1",
  orgId: "org-1",
  userId: "user-1",
};

describe("commitAccounts row filter", () => {
  it("commits only the listed rows", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      accounts: [
        { __rowId: "r1", name: "IRA", value: 100, match: { kind: "new" } },
        { __rowId: "r2", name: "Roth", value: 200, match: { kind: "new" } },
      ] as ImportPayload["accounts"],
    };
    const result = await commitAccounts(tx, payload, { ...ctx, rowIds: ["r1"] });
    expect(result.created).toBe(1);
    const inserts = callsForTable(calls, "accounts").filter((c) => c.op === "insert");
    expect(inserts).toHaveLength(1);
    const values = (inserts[0] as { values: Record<string, unknown> }).values;
    expect(values.name).toBe("IRA");
  });

  it("commits everything when no filter is given", async () => {
    const { tx } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      accounts: [
        { __rowId: "r1", name: "IRA", value: 100, match: { kind: "new" } },
        { __rowId: "r2", name: "Roth", value: 200, match: { kind: "new" } },
      ] as ImportPayload["accounts"],
    };
    const result = await commitAccounts(tx, payload, ctx);
    expect(result.created).toBe(2);
  });

  // C2: the brief's original version of this test seeded `match: { kind:
  // "exact", existingId: "acct-1" }`, which never reaches the INSERT branch
  // at all — `second.created === 0` would hold on the FIRST call too, so it
  // proved nothing about double-posting. Rewritten to exercise the actual
  // mechanism (`linkCreated` mutating the row to `exact` after a create) and
  // to assert directly on the accounts table's insert/update calls, mirroring
  // commit/__tests__/recommit-links.test.ts.
  it("cannot double-post a row already linked to a created record", async () => {
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      accounts: [
        { __rowId: "r1", name: "IRA", value: 100, match: { kind: "new" } },
      ] as ImportPayload["accounts"],
    };

    const first = makeFakeTx();
    first.setInsertId("accounts", "acct-1");
    const firstResult = await commitAccounts(first.tx, payload, { ...ctx, rowIds: ["r1"] });
    expect(firstResult.created).toBe(1);
    expect(callsForTable(first.calls, "accounts").filter((c) => c.op === "insert")).toHaveLength(1);
    // linkCreated mutated the row in place — a re-commit of the same payload
    // must now UPDATE the linked record instead of inserting a second one.
    expect(payload.accounts[0].match).toEqual({ kind: "exact", existingId: "acct-1" });

    const second = makeFakeTx();
    const secondResult = await commitAccounts(second.tx, payload, { ...ctx, rowIds: ["r1"] });
    expect(secondResult.created).toBe(0);
    // The assertion that actually proves no duplicate account was written.
    expect(callsForTable(second.calls, "accounts").filter((c) => c.op === "insert")).toHaveLength(0);
    expect(callsForTable(second.calls, "accounts").filter((c) => c.op === "update")).toHaveLength(1);
  });

  // C4: `ctx.rowIds && ...` treats `[]` as truthy, so an empty list is a
  // filter that matches nothing — the safe fail-closed direction if a caller
  // ever posts one by mistake.
  it("commits nothing when rowIds is an empty array", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      accounts: [
        { __rowId: "r1", name: "IRA", value: 100, match: { kind: "new" } },
      ] as ImportPayload["accounts"],
    };
    const result = await commitAccounts(tx, payload, { ...ctx, rowIds: [] });
    expect(result.created).toBe(0);
    expect(callsForTable(calls, "accounts")).toHaveLength(0);
  });

  // C5: a row with no __rowId can never be identified as "listed", so a
  // filter in effect must skip it rather than guess.
  it("skips a row with no __rowId when a filter is present", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      accounts: [
        { name: "No Row Id", value: 100, match: { kind: "new" } },
      ] as ImportPayload["accounts"],
    };
    const result = await commitAccounts(tx, payload, { ...ctx, rowIds: ["r1"] });
    expect(result.created).toBe(0);
    expect(callsForTable(calls, "accounts")).toHaveLength(0);
  });
});

// C3: rowIds rides on the shared CommitContext but only commitAccounts reads
// it. Pin that a sibling tab is unaffected, so nobody "fixes" this later by
// accident in a way that silently starts filtering every tab.
describe("rowIds does not affect commit modules that don't read it", () => {
  it("commitIncomes commits its rows unfiltered even when ctx.rowIds is set", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      incomes: [
        {
          name: "Salary",
          type: "salary",
          annualAmount: 100000,
          owner: "client",
          match: { kind: "new" },
        },
      ] as ImportPayload["incomes"],
    };
    const result = await commitIncomes(tx, payload, { ...ctx, rowIds: ["some-unrelated-id"] });
    expect(result.created).toBe(1);
    expect(callsForTable(calls, "incomes").filter((c) => c.op === "insert")).toHaveLength(1);
  });
});
