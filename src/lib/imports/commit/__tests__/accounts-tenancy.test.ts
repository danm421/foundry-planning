/**
 * A matched row's `existingId` comes off payload JSON — a claim, not a fact.
 * The accounts UPDATE is scoped to this client and scenario, so it matching no
 * row means the account is not this client's. Then nothing else about that
 * account may be written: not its owners, not its positions, and not its asset
 * mix (the post-commit sync runs off `holdingsAccountIds`).
 */
import { describe, expect, it } from "vitest";

import { commitAccounts } from "../accounts";
import type { CommitContext } from "../types";
import type { FamilyRoleIds } from "../family-resolver";
import { callsForTable, makeFakeTx } from "../../__tests__/commit-test-helpers";
import { emptyImportPayload, type Annotated, type ImportPayload } from "../../types";
import type { ExtractedAccount } from "@/lib/extraction/types";

const FAMILY: FamilyRoleIds = { clientFmId: "fm-client", spouseFmId: "fm-spouse" };

function payloadWithPositions(): ImportPayload {
  const row = {
    __rowId: "row-1",
    name: "Brokerage",
    match: { kind: "exact", existingId: "acct-1" },
    holdings: [{ name: "Bond fund", shares: 1, price: 1, marketValue: 1 }],
  } as Annotated<ExtractedAccount>;
  return { ...emptyImportPayload(), accounts: [row] };
}

function ctxWithSink(sink: string[]): CommitContext {
  return {
    clientId: "client-1",
    scenarioId: "scenario-1",
    orgId: "org-1",
    userId: "user-1",
    rowIds: ["row-1"],
    holdingsAccountIds: sink,
  };
}

describe("a matched row whose account is not this client's", () => {
  it("writes no positions and queues no asset-mix sync", async () => {
    const fake = makeFakeTx();
    fake.setUpdateResult("accounts", []);
    const sink: string[] = [];

    const result = await commitAccounts(fake.tx, payloadWithPositions(), ctxWithSink(sink), FAMILY);

    expect(callsForTable(fake.calls, "account_holdings")).toHaveLength(0);
    expect(sink).toEqual([]);
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("still replaces the positions of an account the update matched", async () => {
    const fake = makeFakeTx();
    const sink: string[] = [];

    const result = await commitAccounts(fake.tx, payloadWithPositions(), ctxWithSink(sink), FAMILY);

    const ops = callsForTable(fake.calls, "account_holdings").map((c) => c.op);
    expect(ops).toEqual(["delete", "insert"]);
    expect(sink).toEqual(["acct-1"]);
    expect(result.updated).toBe(1);
  });
});
