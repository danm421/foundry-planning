import { describe, expect, it, vi } from "vitest";
import { commitAccounts } from "@/lib/imports/commit/accounts";
import { accountHoldingsGuardrail } from "@/lib/imports/commit/holdings-guardrail";
import { resolveHoldingsForCommit } from "@/lib/imports/commit/holdings";
import type { CommitContext } from "@/lib/imports/commit/types";
import { emptyImportPayload, type ImportPayload } from "@/lib/imports/types";

import { callsForTable, makeFakeTx } from "./commit-test-helpers";

function payloadWith(accounts: ImportPayload["accounts"]): ImportPayload {
  return {
    dependents: [], accounts, incomes: [], expenses: [], liabilities: [],
    lifePolicies: [], wills: [], entities: [], savings: [], warnings: [],
  };
}

describe("resolveHoldingsForCommit", () => {
  it("uses a cached security and skips classification", async () => {
    const getSecurityByTicker = vi.fn().mockResolvedValue({ security: { id: "sec-1" }, weights: [] });
    const classifySecurity = vi.fn();
    const upsertClassifiedSecurity = vi.fn();
    const fetchEodCloses = vi.fn().mockResolvedValue(new Map([["VTI.US", { price: 210, asOf: "2026-06-09" }]]));

    const map = await resolveHoldingsForCommit(
      payloadWith([{ name: "B", match: { kind: "new" }, holdings: [{ ticker: "vti", shares: 1 }] }]),
      { getSecurityByTicker, classifySecurity, upsertClassifiedSecurity, fetchEodCloses },
    );
    expect(classifySecurity).not.toHaveBeenCalled();
    expect(map.get("VTI")).toEqual({ securityId: "sec-1", price: 210, asOf: "2026-06-09" });
  });

  it("classifies + upserts on cache miss", async () => {
    const getSecurityByTicker = vi.fn().mockResolvedValue(null);
    const classifySecurity = vi.fn().mockResolvedValue({ identifier: "AAPL" });
    const upsertClassifiedSecurity = vi.fn().mockResolvedValue("sec-aapl");
    const fetchEodCloses = vi.fn().mockResolvedValue(new Map());

    const map = await resolveHoldingsForCommit(
      payloadWith([{ name: "B", match: { kind: "new" }, holdings: [{ ticker: "AAPL", shares: 1 }] }]),
      { getSecurityByTicker, classifySecurity, upsertClassifiedSecurity, fetchEodCloses },
    );
    expect(upsertClassifiedSecurity).toHaveBeenCalled();
    expect(map.get("AAPL")).toEqual({ securityId: "sec-aapl", price: null, asOf: null });
  });

  it("omits a ticker when classification fails (manual fallback)", async () => {
    const map = await resolveHoldingsForCommit(
      payloadWith([{ name: "B", match: { kind: "new" }, holdings: [{ ticker: "ZZZZ", shares: 1 }] }]),
      {
        getSecurityByTicker: vi.fn().mockResolvedValue(null),
        classifySecurity: vi.fn().mockResolvedValue(null),
        upsertClassifiedSecurity: vi.fn(),
        fetchEodCloses: vi.fn().mockResolvedValue(new Map()),
      },
    );
    expect(map.has("ZZZZ")).toBe(false);
  });

  it("ignores untickered holdings and fuzzy accounts", async () => {
    const getSecurityByTicker = vi.fn().mockResolvedValue({ security: { id: "sec-x" }, weights: [] });
    const map = await resolveHoldingsForCommit(
      payloadWith([
        { name: "Bonds", match: { kind: "new" }, holdings: [{ name: "Cash", shares: 100 }] },
        { name: "Fuzzy", match: { kind: "fuzzy", candidates: [] }, holdings: [{ ticker: "IGNORED", shares: 1 }] },
      ]),
      { getSecurityByTicker, classifySecurity: vi.fn(), upsertClassifiedSecurity: vi.fn(),
        fetchEodCloses: vi.fn().mockResolvedValue(new Map()) },
    );
    expect(getSecurityByTicker).not.toHaveBeenCalled();
    expect(map.size).toBe(0);
  });

  // Task 7, IMPORTANT 2: a per-row commit from the chat surface passes
  // `rowIds` so this Phase-A resolve pays for classification + a live quote
  // fetch only for the row(s) actually being committed — without this, a
  // 12-account statement committed one row at a time would pay the whole
  // payload's ticker cost on every single row.
  it("resolves tickers only for the rows listed in rowIds, when given", async () => {
    const getSecurityByTicker = vi.fn().mockResolvedValue({ security: { id: "sec-1" }, weights: [] });
    const classifySecurity = vi.fn();
    const upsertClassifiedSecurity = vi.fn();
    const fetchEodCloses = vi.fn().mockResolvedValue(new Map());

    const payload = payloadWith([
      { __rowId: "r1", name: "Wanted", match: { kind: "new" }, holdings: [{ ticker: "VTI", shares: 1 }] },
      { __rowId: "r2", name: "Unwanted", match: { kind: "new" }, holdings: [{ ticker: "AAPL", shares: 1 }] },
    ] as ImportPayload["accounts"]);

    const map = await resolveHoldingsForCommit(
      payload,
      { getSecurityByTicker, classifySecurity, upsertClassifiedSecurity, fetchEodCloses },
      ["r1"],
    );
    expect(getSecurityByTicker).toHaveBeenCalledTimes(1);
    expect(getSecurityByTicker).toHaveBeenCalledWith("VTI");
    expect(map.has("VTI")).toBe(true);
    expect(map.has("AAPL")).toBe(false);
  });

  it("skips a row with no __rowId when rowIds is given, same as the committer's guard", async () => {
    const getSecurityByTicker = vi.fn().mockResolvedValue({ security: { id: "sec-1" }, weights: [] });
    const payload = payloadWith([
      { name: "No Row Id", match: { kind: "new" }, holdings: [{ ticker: "VTI", shares: 1 }] },
    ] as ImportPayload["accounts"]);

    const map = await resolveHoldingsForCommit(
      payload,
      { getSecurityByTicker, classifySecurity: vi.fn(), upsertClassifiedSecurity: vi.fn(),
        fetchEodCloses: vi.fn().mockResolvedValue(new Map()) },
      ["r1"],
    );
    expect(getSecurityByTicker).not.toHaveBeenCalled();
    expect(map.size).toBe(0);
  });
});

// R7: the brief's Step 4 calls a `commitAccountsForTest([row])` helper that
// does not exist. The commit-half assertion below goes through the real
// write path instead — `commitAccounts` against the `makeFakeTx` harness
// (as `accounts-row-filter.test.ts` already does), asserting directly on the
// `account_holdings` insert the fake tx recorded. That is narrower and more
// honest than routing through `resolveHoldingsForCommit`, which is Phase A
// (ticker resolution) and never reaches `account_holdings` at all — a test
// through it could pass while a tombstoned position was still written.
describe("commit writes only tombstoned-free holdings", () => {
  const ctx: CommitContext = {
    clientId: "client-1",
    scenarioId: "scenario-1",
    orgId: "org-1",
    userId: "user-1",
  };

  it("never writes a tombstoned position to account_holdings", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      accounts: [
        {
          name: "Brokerage", accountNumberLast4: "1234", custodian: "Schwab", value: 300,
          holdings: [
            { ticker: "AAPL", marketValue: 100, __holdingId: "t:AAPL#0" },
            { ticker: "MSFT", marketValue: 200, __holdingId: "t:MSFT#0", __dropped: true },
          ],
        },
      ] as ImportPayload["accounts"],
    };
    await commitAccounts(tx, payload, ctx);
    const inserts = callsForTable(calls, "account_holdings").filter((c) => c.op === "insert");
    expect(inserts).toHaveLength(1);
    const rows = (inserts[0] as { values: Array<{ displayTicker: string | null }> }).values;
    expect(rows.map((r) => r.displayTicker)).toEqual(["AAPL"]);
  });

  /**
   * The gate that decides "does this account have positions to speak of" read
   * the RAW array while everything it guards reads `livingHoldings`. Dropping
   * every position therefore kept the gate truthy, ran the guardrail on an
   * empty set (which returns `deriveFromHoldings: true`), and then hit
   * `writeAccountHoldings`' empty-array early return BEFORE its `replace`
   * delete — so the account's old positions survived in `account_holdings`
   * while the flag now told the plan to derive its value from them.
   *
   * Mutation this catches: restoring `if (row.holdings?.length)` on the
   * guardrail gate, or ordering the `replace` delete after the empty check.
   */
  it("clears an existing account's positions when the advisor drops them all, and stops deriving", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      accounts: [
        {
          name: "Brokerage", accountNumberLast4: "1234", custodian: "Schwab", value: 604756,
          match: { kind: "exact", existingId: "acct-1" },
          holdings: [
            { ticker: "AAPL", marketValue: 100, __holdingId: "t:AAPL#0", __dropped: true },
            { ticker: "MSFT", marketValue: 200, __holdingId: "t:MSFT#0", __dropped: true },
          ],
        },
      ] as ImportPayload["accounts"],
    };
    await commitAccounts(tx, payload, ctx);

    // The stale rows are actually removed — not left behind an early return.
    const holdingCalls = callsForTable(calls, "account_holdings");
    expect(holdingCalls.filter((c) => c.op === "delete")).toHaveLength(1);
    expect(holdingCalls.filter((c) => c.op === "insert")).toHaveLength(0);

    // ...and the account is told to stop deriving, or it would roll up the
    // positions we just deleted and value itself at $0.
    const accountUpdate = callsForTable(calls, "accounts").find((c) => c.op === "update");
    const values = (accountUpdate as { values: Record<string, unknown> }).values;
    expect(values.deriveFromHoldings).toBe(false);
    // The stated value is what governs now, so it must still be written.
    expect(values.value).toBe("604756");
  });

  /**
   * The other half of the same asymmetry: an import that says NOTHING about
   * an account's positions (a CSV of balances, a statement with no position
   * table) must leave that account's existing holdings alone. Deleting on
   * every `replace` would make the fix above a data-loss bug in the opposite
   * direction.
   *
   * Mutation this catches: deleting unconditionally when `replace` is true.
   */
  it("leaves an existing account's positions alone when the import carries none", async () => {
    const { tx, calls } = makeFakeTx();
    const payload: ImportPayload = {
      ...emptyImportPayload(),
      accounts: [
        {
          name: "Brokerage", accountNumberLast4: "1234", custodian: "Schwab", value: 604756,
          match: { kind: "exact", existingId: "acct-1" },
        },
      ] as ImportPayload["accounts"],
    };
    await commitAccounts(tx, payload, ctx);

    expect(callsForTable(calls, "account_holdings")).toHaveLength(0);
    const accountUpdate = callsForTable(calls, "accounts").find((c) => c.op === "update");
    const values = (accountUpdate as { values: Record<string, unknown> }).values;
    expect(values.deriveFromHoldings).toBeUndefined();
  });

  it("reconciles the value against living positions only", () => {
    // $100 of living holdings against a $300 stated value materially
    // undershoots, so the stated value is preserved rather than derived.
    const decision = accountHoldingsGuardrail({
      value: 300,
      holdings: [
        { ticker: "AAPL", marketValue: 100 },
        { ticker: "MSFT", marketValue: 200, __dropped: true },
      ],
    });
    expect(decision.deriveFromHoldings).toBe(false);
  });
});
