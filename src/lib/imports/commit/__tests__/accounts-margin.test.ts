/**
 * A statement's margin loan lands on the taxable account it belongs to — the
 * account's own margin-loan fields, never a separate debt. The DB allows a loan
 * only on a taxable account (`accounts_margin_taxable_only`), so a row breaking
 * that keeps its loan off — saved at its net value — and says so rather than
 * rolling back the import.
 */
import { describe, expect, it } from "vitest";

import { commitAccounts, importedMarginColumns } from "../accounts";
import type { CommitContext } from "../types";
import type { FamilyRoleIds } from "../family-resolver";
import { callsForTable, makeFakeTx, type FakeTx } from "../../__tests__/commit-test-helpers";
import { emptyImportPayload, type Annotated, type ImportPayload } from "../../types";
import type { ExtractedAccount } from "@/lib/extraction/types";

const CTX: CommitContext = { clientId: "client-1", scenarioId: "scenario-1", orgId: "org-1", userId: "user-1" };
const FAMILY: FamilyRoleIds = { clientFmId: "fm-client", spouseFmId: "fm-spouse" };

function row(extra: Partial<Annotated<ExtractedAccount>> = {}): Annotated<ExtractedAccount> {
  return {
    __rowId: "row-1",
    name: "Joint Brokerage",
    category: "taxable",
    subType: "brokerage",
    owner: "joint",
    value: 540_000,
    marginBalance: 40_000,
    marginInterestRate: 0.085,
    match: { kind: "new" },
    ...extra,
  } as Annotated<ExtractedAccount>;
}

const payloadOf = (r: Annotated<ExtractedAccount>): ImportPayload => ({ ...emptyImportPayload(), accounts: [r] });

function accountWrite(fake: FakeTx, op: "insert" | "update"): Record<string, unknown> {
  const writes = callsForTable(fake.calls, "accounts").filter((c) => c.op === op);
  expect(writes).toHaveLength(1);
  return (writes[0] as { values: Record<string, unknown> }).values;
}

describe("a new account from a statement", () => {
  it("carries the statement's margin loan and rate", async () => {
    const fake = makeFakeTx();
    const result = await commitAccounts(fake.tx, payloadOf(row()), CTX, FAMILY);

    const values = accountWrite(fake, "insert");
    expect(values.value).toBe("540000");
    expect(values.marginBalance).toBe("40000");
    expect(values.marginInterestRate).toBe("0.085");
    expect(result.warnings).toEqual([]);
  });

  it("keeps the loan off a non-taxable account and says so", async () => {
    const fake = makeFakeTx();
    const result = await commitAccounts(
      fake.tx,
      payloadOf(row({ category: "retirement", subType: "traditional_ira", owner: "client" })),
      CTX,
      FAMILY,
    );

    const values = accountWrite(fake, "insert");
    expect(values).not.toHaveProperty("marginBalance");
    expect(values.value).toBe("500000"); // the payload's value is gross of a loan it can't keep
    expect(result.warnings).toEqual([
      "Joint Brokerage: margin loan not saved — only a taxable brokerage account can carry one. Saved at its value net of the loan.",
    ]);
  });

  it("writes nothing for an account with no loan", async () => {
    const fake = makeFakeTx();
    await commitAccounts(fake.tx, payloadOf(row({ marginBalance: undefined, marginInterestRate: undefined })), CTX, FAMILY);
    const values = accountWrite(fake, "insert");
    expect(values).not.toHaveProperty("marginBalance");
    expect(values).not.toHaveProperty("marginInterestRate");
  });
});

describe("a statement matched to an existing account", () => {
  const matched = (extra: Partial<Annotated<ExtractedAccount>> = {}) =>
    row({ match: { kind: "exact", existingId: "acct-1" }, ...extra });

  it("replaces the stored loan when the row says taxable", async () => {
    const fake = makeFakeTx();
    await commitAccounts(fake.tx, payloadOf(matched()), CTX, FAMILY);
    const set = accountWrite(fake, "update");
    expect(set.marginBalance).toBe("40000");
    expect(set.marginInterestRate).toBe("0.085");
  });

  it("checks the STORED category when the row names none", async () => {
    const fake = makeFakeTx();
    fake.setSelectResult("accounts", [{ category: "cash", marginBalance: "0", marginBorrowEnabled: false }]);
    const result = await commitAccounts(fake.tx, payloadOf(matched({ category: undefined })), CTX, FAMILY);

    const set = accountWrite(fake, "update");
    expect(set).not.toHaveProperty("marginBalance");
    expect(set.value).toBe("500000");
    expect(result.warnings).toEqual([
      "Joint Brokerage: margin loan not saved — only a taxable brokerage account can carry one. Saved at its value net of the loan.",
    ]);
  });

  it("writes the loan onto a stored taxable account when the row names no category", async () => {
    const fake = makeFakeTx();
    fake.setSelectResult("accounts", [{ category: "taxable", marginBalance: "0", marginBorrowEnabled: false }]);
    await commitAccounts(fake.tx, payloadOf(matched({ category: undefined })), CTX, FAMILY);
    expect(accountWrite(fake, "update").marginBalance).toBe("40000");
  });

  it("leaves the stored loan alone when the statement shows none", async () => {
    const fake = makeFakeTx();
    await commitAccounts(fake.tx, payloadOf(matched({ marginBalance: undefined, marginInterestRate: undefined })), CTX, FAMILY);
    const set = accountWrite(fake, "update");
    expect(set).not.toHaveProperty("marginBalance");
    expect(set).not.toHaveProperty("marginInterestRate");
  });
});

describe("importedMarginColumns", () => {
  const base = { name: "Joint Brokerage", value: 540_000, marginBalance: 40_000 };

  // Spec R7: imports may leave the loan above the value — an underwater account.
  it("keeps a loan as large as the account", () => {
    expect(importedMarginColumns({ ...base, value: 35_000 }, "taxable")).toEqual({
      columns: { marginBalance: "40000" },
      warnings: [],
    });
  });

  it("keeps the loan but drops a rate outside 0–25% (a percent the model forgot to convert)", () => {
    expect(importedMarginColumns({ ...base, marginInterestRate: 8.5 }, "taxable")).toEqual({
      columns: { marginBalance: "40000" },
      warnings: ["Joint Brokerage: margin interest rate not saved — it must be between 0% and 25%."],
    });
  });

  it("writes the loan alone when no rate was printed", () => {
    expect(importedMarginColumns(base, "taxable")).toEqual({ columns: { marginBalance: "40000" }, warnings: [] });
  });

  it("treats a 0 loan (cleared in review) as none", () => {
    expect(importedMarginColumns({ ...base, marginBalance: 0 }, "taxable")).toEqual({ columns: {}, warnings: [] });
  });
});
