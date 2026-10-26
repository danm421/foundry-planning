/**
 * A feed's cost basis is what an account's positions cost. On a retirement
 * account `accounts.basis` is post-tax (Form 8606) basis, which the engine pays
 * out untaxed, so a feed row (one carrying `externalProvider`) never writes it
 * there. Covers every feed write at once: the account panel's Connect and Add,
 * the sync's auto-commit, and committing a feed's review.
 */
import { describe, expect, it } from "vitest";

import { commitAccounts } from "../accounts";
import type { CommitContext } from "../types";
import type { FamilyRoleIds } from "../family-resolver";
import { callsForTable, makeFakeTx, type FakeTx } from "../../__tests__/commit-test-helpers";
import { emptyImportPayload, type Annotated, type ImportPayload } from "../../types";
import type { ExtractedAccount } from "@/lib/extraction/types";

const CTX: CommitContext = { clientId: "client-1", scenarioId: "scenario-1", orgId: "org-1", userId: "user-1" };
const FAMILY: FamilyRoleIds = { clientFmId: "fm-client", spouseFmId: null };

function feedRow(extra: Partial<Annotated<ExtractedAccount>> = {}): Annotated<ExtractedAccount> {
  return {
    name: "Fidelity 1234",
    value: 50_000,
    basis: 42_000,
    externalProvider: "addepar",
    externalId: "addepar-1234",
    ...extra,
  } as Annotated<ExtractedAccount>;
}

const payloadOf = (r: Annotated<ExtractedAccount>): ImportPayload => ({ ...emptyImportPayload(), accounts: [r] });

function accountWrite(fake: FakeTx, op: "insert" | "update"): Record<string, unknown> {
  const writes = callsForTable(fake.calls, "accounts").filter((c) => c.op === op);
  expect(writes).toHaveLength(1);
  return (writes[0] as { values: Record<string, unknown> }).values;
}

const exact = { kind: "exact", existingId: "acct-1" } as const;
const stored = (category: string) => [{ category, marginBalance: "0", marginBorrowEnabled: false }];

describe("a feed's cost basis on a retirement account", () => {
  it("a feed's cost basis never becomes a retirement account's post-tax basis", async () => {
    // New: an account added from the feed as a Roth IRA starts with no basis.
    const added = makeFakeTx();
    await commitAccounts(
      added.tx,
      payloadOf(feedRow({ category: "retirement", subType: "roth_ira", owner: "client", match: { kind: "new" } })),
      CTX,
      FAMILY,
    );
    expect(accountWrite(added, "insert").basis).toBe("0");

    // Exact, the row naming no type (Connect, the sync): the stored IRA keeps its basis.
    const connected = makeFakeTx();
    connected.setSelectResult("accounts", stored("retirement"));
    await commitAccounts(connected.tx, payloadOf(feedRow({ match: exact })), CTX, FAMILY);
    const set = accountWrite(connected, "update");
    expect(set).not.toHaveProperty("basis");
    expect(set.value).toBe("50000");

    // Exact, the row MAKING the account retirement (a reviewed feed row): still no basis.
    const retyped = makeFakeTx();
    retyped.setSelectResult("accounts", stored("taxable"));
    await commitAccounts(
      retyped.tx,
      payloadOf(feedRow({ category: "retirement", subType: "traditional_ira", match: exact })),
      CTX,
      FAMILY,
    );
    expect(accountWrite(retyped, "update")).not.toHaveProperty("basis");
  });

  it("a taxable account still takes the feed's cost basis", async () => {
    const added = makeFakeTx();
    await commitAccounts(
      added.tx,
      payloadOf(feedRow({ category: "taxable", subType: "brokerage", owner: "client", match: { kind: "new" } })),
      CTX,
      FAMILY,
    );
    expect(accountWrite(added, "insert").basis).toBe("42000");

    const connected = makeFakeTx();
    connected.setSelectResult("accounts", stored("taxable"));
    await commitAccounts(connected.tx, payloadOf(feedRow({ match: exact })), CTX, FAMILY);
    expect(accountWrite(connected, "update").basis).toBe("42000");
  });

  it("a statement's basis on a retirement account is written as before", async () => {
    const statement = feedRow({
      externalProvider: undefined,
      externalId: undefined,
      category: "retirement",
      subType: "traditional_ira",
      owner: "client",
    });
    const added = makeFakeTx();
    await commitAccounts(added.tx, payloadOf({ ...statement, match: { kind: "new" } }), CTX, FAMILY);
    expect(accountWrite(added, "insert").basis).toBe("42000");

    const matched = makeFakeTx();
    await commitAccounts(matched.tx, payloadOf({ ...statement, match: exact }), CTX, FAMILY);
    expect(accountWrite(matched, "update").basis).toBe("42000");
  });
});
