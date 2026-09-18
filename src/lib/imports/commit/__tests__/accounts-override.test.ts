/**
 * "Override all fields" — the checkbox under a matched row's Commit button.
 *
 * Matching an extracted row to an existing account normally replaces the
 * statement's own facts (balance, basis, last 4, institution, type, positions)
 * and PROTECTS two things the advisor owns: the account's `name` and its
 * ownership. The checkbox hands those two over as well, and nothing else —
 * growth in particular stays the advisor's.
 *
 * Every case here drives `commitAccounts` against the fake transaction and
 * asserts on the SQL it issued, because the whole feature is a field map and
 * a field map is only observable in the write.
 */
import { describe, expect, it } from "vitest";

import { commitAccounts } from "../accounts";
import type { CommitContext } from "../types";
import type { FamilyRoleIds } from "../family-resolver";
import { callsForTable, makeFakeTx, type FakeTx, type FakeTxCall } from "../../__tests__/commit-test-helpers";
import { emptyImportPayload, type Annotated, type ImportPayload } from "../../types";
import type { ExtractedAccount } from "@/lib/extraction/types";

const CTX: CommitContext = {
  clientId: "client-1",
  scenarioId: "scenario-1",
  orgId: "org-1",
  userId: "user-1",
  rowIds: ["row-1"],
};

const FAMILY: FamilyRoleIds = { clientFmId: "fm-client", spouseFmId: "fm-spouse" };

/** A matched row, as the chat surface hands one to the commit route. */
function matchedRow(extra: Partial<ExtractedAccount> = {}): Annotated<ExtractedAccount> {
  return {
    __rowId: "row-1",
    name: "Schwab Brokerage ...4321",
    value: 250_000,
    accountNumberLast4: "4321",
    custodian: "Schwab",
    owner: "joint",
    match: { kind: "exact", existingId: "acct-1" },
    ...extra,
  } as Annotated<ExtractedAccount>;
}

function payloadOf(row: Annotated<ExtractedAccount>): ImportPayload {
  return { ...emptyImportPayload(), accounts: [row] };
}

/** The `SET` clause of the single accounts UPDATE this commit issued. */
function updateSet(fake: FakeTx): Record<string, unknown> {
  const updates = callsForTable(fake.calls, "accounts").filter((c) => c.op === "update");
  expect(updates).toHaveLength(1);
  return (updates[0] as { values: Record<string, unknown> }).values;
}

function ownerCalls(fake: FakeTx, op: "insert" | "delete"): FakeTxCall[] {
  return callsForTable(fake.calls, "account_owners").filter((c) => c.op === op);
}

/** Flattens an owners insert, which may be one row or an array of them. */
function ownerRows(call: FakeTxCall): Record<string, unknown>[] {
  const v = (call as { values: unknown }).values;
  return (Array.isArray(v) ? v : [v]) as Record<string, unknown>[];
}

/**
 * The existing row as the scoped UPDATE's `returning()` reports it back —
 * `subType` included, because that is what decides whether ownership may be
 * split. Registering `[]` instead models a WHERE that matched nothing, i.e.
 * an `existingId` that is not this client's.
 */
function existingAccount(fake: FakeTx, subType: string) {
  fake.setUpdateResult("accounts", [{ id: "acct-1", subType }]);
}

describe("a matched row WITHOUT the override box ticked", () => {
  it("replaces the last 4 and the institution — the statement's own facts", async () => {
    const fake = makeFakeTx();
    existingAccount(fake, "brokerage");
    await commitAccounts(fake.tx, payloadOf(matchedRow()), CTX, FAMILY);

    const set = updateSet(fake);
    expect(set.accountNumberLast4).toBe("4321");
    expect(set.custodian).toBe("Schwab");
    expect(set.value).toBe("250000");
  });

  it("leaves the account's name and its ownership alone", async () => {
    const fake = makeFakeTx();
    existingAccount(fake, "brokerage");
    await commitAccounts(fake.tx, payloadOf(matchedRow()), CTX, FAMILY);

    expect(updateSet(fake)).not.toHaveProperty("name");
    expect(ownerCalls(fake, "delete")).toHaveLength(0);
    expect(ownerCalls(fake, "insert")).toHaveLength(0);
  });
});

describe("a matched row WITH the override box ticked", () => {
  const OVERRIDE: CommitContext = { ...CTX, overrideRowIds: ["row-1"] };

  it("replaces the name with the statement's", async () => {
    const fake = makeFakeTx();
    existingAccount(fake, "brokerage");
    await commitAccounts(fake.tx, payloadOf(matchedRow()), OVERRIDE, FAMILY);

    expect(updateSet(fake).name).toBe("Schwab Brokerage ...4321");
  });

  it("replaces ownership — delete then insert, never one without the other", async () => {
    const fake = makeFakeTx();
    existingAccount(fake, "brokerage");
    await commitAccounts(fake.tx, payloadOf(matchedRow()), OVERRIDE, FAMILY);

    expect(ownerCalls(fake, "delete")).toHaveLength(1);
    const inserts = ownerCalls(fake, "insert");
    expect(inserts).toHaveLength(1);
    // "joint" on a non-retirement account: 50/50 across the two spouses.
    expect(ownerRows(inserts[0])).toEqual([
      { accountId: "acct-1", familyMemberId: "fm-client", entityId: null, percent: "0.5000" },
      { accountId: "acct-1", familyMemberId: "fm-spouse", entityId: null, percent: "0.5000" },
    ]);
  });

  it("still does NOT touch growth — the one field the label promises to leave", async () => {
    const fake = makeFakeTx();
    existingAccount(fake, "brokerage");
    // A row carrying no growth of its own, which is every statement-chat row:
    // the surface has no growth column to fill.
    await commitAccounts(fake.tx, payloadOf(matchedRow()), OVERRIDE, FAMILY);

    const set = updateSet(fake);
    expect(set).not.toHaveProperty("growthRate");
    expect(set).not.toHaveProperty("growthSource");
  });

  it("collapses a 'joint' IRA to ONE owner, reading the stored sub-type", async () => {
    // The advisor never touched the type cell, so the row says nothing about
    // sub-type — the stored one comes back on the UPDATE's returning(). Two
    // owners here would trip account_owners_retirement_check, which is
    // DEFERRABLE INITIALLY DEFERRED: the rollback lands at COMMIT and takes
    // the whole import down with it.
    const fake = makeFakeTx();
    existingAccount(fake, "traditional_ira");
    await commitAccounts(fake.tx, payloadOf(matchedRow()), OVERRIDE, FAMILY);

    const rows = ownerRows(ownerCalls(fake, "insert")[0]);
    expect(rows).toHaveLength(1);
    expect(rows[0].percent).toBe("1.0000");
  });

  it("leaves ownership as it was when nobody in the household can be resolved", async () => {
    // Deleting and then writing nothing would strand the account ownerless,
    // which drops its balance out of every by-owner readout.
    const fake = makeFakeTx();
    existingAccount(fake, "brokerage");
    const result = await commitAccounts(fake.tx, payloadOf(matchedRow()), OVERRIDE, {
      clientFmId: null,
      spouseFmId: null,
    });

    expect(ownerCalls(fake, "delete")).toHaveLength(0);
    expect(ownerCalls(fake, "insert")).toHaveLength(0);
    expect(result.updated).toBe(1);
    expect(result.warnings).toEqual([
      "Schwab Brokerage ...4321: ownership left unchanged — the statement's owner " +
        "could not be matched to anyone in this household.",
    ]);
  });

  it("touches NOTHING when the account belongs to another client", async () => {
    // `existingId` arrives on payload JSON — a claim, not a fact — and
    // account_owners has no clientId of its own to scope a delete by. The
    // scoped UPDATE matching no row is the only tenancy signal there is.
    const fake = makeFakeTx();
    fake.setUpdateResult("accounts", []);
    await commitAccounts(fake.tx, payloadOf(matchedRow()), OVERRIDE, FAMILY);

    expect(ownerCalls(fake, "delete")).toHaveLength(0);
    expect(ownerCalls(fake, "insert")).toHaveLength(0);
  });

  it("does not rename an account to a blank", async () => {
    const fake = makeFakeTx();
    existingAccount(fake, "brokerage");
    await commitAccounts(fake.tx, payloadOf(matchedRow({ name: "   " })), OVERRIDE, FAMILY);

    expect(updateSet(fake)).not.toHaveProperty("name");
  });

  it("writes no owners for a 529 — its beneficiary columns are its ownership", async () => {
    const fake = makeFakeTx();
    existingAccount(fake, "529");
    const row = matchedRow({
      category: "education_savings",
      subType: "529",
      beneficiaryName: "Ada",
    });
    await commitAccounts(fake.tx, payloadOf(row), OVERRIDE, FAMILY);

    // The 529 branch clears ownership and the override must not put it back.
    expect(ownerCalls(fake, "delete")).toHaveLength(1);
    expect(ownerCalls(fake, "insert")).toHaveLength(0);
  });

  it("only widens the rows it names — a second matched row keeps its name", async () => {
    const fake = makeFakeTx();
    existingAccount(fake, "brokerage");
    const other = matchedRow({ name: "Fidelity IRA" });
    other.__rowId = "row-2";
    (other.match as { existingId: string }).existingId = "acct-2";
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      accounts: [matchedRow(), other],
    };

    await commitAccounts(
      fake.tx,
      payload,
      { ...CTX, rowIds: ["row-1", "row-2"], overrideRowIds: ["row-1"] },
      FAMILY,
    );

    const updates = callsForTable(fake.calls, "accounts")
      .filter((c) => c.op === "update")
      .map((c) => (c as { values: Record<string, unknown> }).values);
    expect(updates).toHaveLength(2);
    expect(updates[0].name).toBe("Schwab Brokerage ...4321");
    expect(updates[1]).not.toHaveProperty("name");
    expect(ownerCalls(fake, "insert")).toHaveLength(1);
  });
});
