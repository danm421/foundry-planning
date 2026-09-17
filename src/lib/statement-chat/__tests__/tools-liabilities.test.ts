import { describe, it, expect } from "vitest";
import {
  editRow,
  mergeRows,
  dropRow,
  editHolding,
  explain,
  EDITABLE_LIABILITY_FIELDS,
} from "@/lib/statement-chat/tools";
import type { PersistedImportPayload } from "@/lib/imports/types";

/**
 * Task 12: the chat tools reach the LIABILITIES table, not just accounts.
 *
 * Ids here are the real shape `keyedRowId` (`merge-across-files.ts`) mints —
 * `${label}:${key}#${fileId}:${index}` — because the whole design turns on the
 * section prefix: the id itself says which table a row is in, so no tool takes
 * a `table` argument the model could be wrong about. A fixture using bare
 * `r1`/`r2` ids would pass whatever the locator did with the prefix.
 */
const ACCOUNT_ID = "account:ira#f1:0";
const MORTGAGE_ID = "liability:mortgage#f1:0";
const HELOC_ID = "liability:heloc#f1:0";

const payload = (): PersistedImportPayload =>
  ({
    accounts: [
      {
        __rowId: ACCOUNT_ID,
        name: "IRA",
        value: 10_000,
        basis: 5_000,
        custodian: "Fidelity",
        __provenance: { sourceFileId: "f1", section: "accounts" },
      },
    ],
    liabilities: [
      {
        __rowId: MORTGAGE_ID,
        name: "Mortgage",
        balance: 412_000,
        interestRate: 0.0525,
        monthlyPayment: 2_100,
        totalPayment: 2_600,
        propertyAddress: "12 Oak Street",
        balanceAsOfDate: "2026-06-30",
        __provenance: { sourceFileId: "f1", section: "liabilities", pageRange: [1, 2] },
      },
      {
        __rowId: HELOC_ID,
        name: "HELOC",
        balance: 40_000,
        lender: "Third Federal",
      },
    ],
  }) as unknown as PersistedImportPayload;

const NONE_COMMITTED: ReadonlySet<string> = new Set<string>();

describe("edit_row across both tables", () => {
  it("edits a liability row by id", () => {
    const before = payload();
    const out = editRow(
      before,
      { rowId: MORTGAGE_ID, field: "interestRate", value: 0.0625 },
      NONE_COMMITTED,
    );
    expect(out.payload.liabilities![0].interestRate).toBe(0.0625);
    // The OTHER table must be untouched — a locator that wrote the liability
    // edit into `accounts` would still satisfy the assertion above if it also
    // appended a row, and a rewrite that rebuilt both arrays would silently
    // drop annotations off every account.
    expect(out.payload.accounts).toEqual(before.accounts);
    expect(out.summary).toMatch(/Mortgage/);
  });

  it("still edits an account row by id", () => {
    const out = editRow(
      payload(),
      { rowId: ACCOUNT_ID, field: "value", value: 500_000 },
      NONE_COMMITTED,
    );
    expect(out.payload.accounts![0].value).toBe(500_000);
    expect(out.payload.liabilities![0].balance).toBe(412_000);
  });

  it("refuses a field that is not on the liability allowlist", () => {
    expect(() =>
      editRow(payload(), { rowId: MORTGAGE_ID, field: "__provenance", value: 1 }, NONE_COMMITTED),
    ).toThrow(/not editable/i);
  });

  it("refuses an account-only field on a liability row", () => {
    expect(() =>
      editRow(
        payload(),
        { rowId: MORTGAGE_ID, field: "custodian", value: "Fidelity" },
        NONE_COMMITTED,
      ),
    ).toThrow(/not editable/i);
  });

  it("refuses a liability-only field on an account row", () => {
    expect(() =>
      editRow(payload(), { rowId: ACCOUNT_ID, field: "balance", value: 1 }, NONE_COMMITTED),
    ).toThrow(/not editable/i);
  });

  it("lists ids from BOTH tables when a row id is unknown", () => {
    expect(() =>
      editRow(payload(), { rowId: "nope", field: "name", value: "x" }, NONE_COMMITTED),
    ).toThrow(new RegExp(`${ACCOUNT_ID}.*${MORTGAGE_ID}`, "s"));
  });

  /**
   * A rate is a DECIMAL FRACTION everywhere in this codebase (0.0625 = 6.25%),
   * so a model writing the percent it read off the statement is a 100x error
   * that would otherwise be stored and amortized. The allowlist alone cannot
   * catch it — `interestRate` is a legitimately editable column.
   */
  it("refuses a percent-shaped interest rate", () => {
    expect(() =>
      editRow(payload(), { rowId: MORTGAGE_ID, field: "interestRate", value: 6.25 }, NONE_COMMITTED),
    ).toThrow(/interestRate/);
    expect(() =>
      editRow(payload(), { rowId: MORTGAGE_ID, field: "interestRate", value: -0.01 }, NONE_COMMITTED),
    ).toThrow(/interestRate/);
  });

  it("refuses a balance that is not a finite number", () => {
    expect(() =>
      editRow(payload(), { rowId: MORTGAGE_ID, field: "balance", value: "412000" }, NONE_COMMITTED),
    ).toThrow(/balance/);
  });

  it("refuses a date that is not ISO YYYY-MM-DD, and accepts one that is", () => {
    expect(() =>
      editRow(
        payload(),
        { rowId: MORTGAGE_ID, field: "maturityDate", value: "June 2055" },
        NONE_COMMITTED,
      ),
    ).toThrow(/maturityDate/);
    const out = editRow(
      payload(),
      { rowId: MORTGAGE_ID, field: "maturityDate", value: "2055-06-01" },
      NONE_COMMITTED,
    );
    expect(out.payload.liabilities![0].maturityDate).toBe("2055-06-01");
  });

  it("refuses to change a committed liability row", () => {
    expect(() =>
      editRow(
        payload(),
        { rowId: MORTGAGE_ID, field: "balance", value: 1 },
        new Set([MORTGAGE_ID]),
      ),
    ).toThrow(/already been committed/i);
  });

  /** The allowlist is the contract Step 3 names; pinning it stops a column
   *  being added to the liabilities table and silently becoming writable, or
   *  the derived escrow cell being added as if it had somewhere to write. */
  it("allows exactly the eight editable liability fields, and no derived escrow field", () => {
    expect([...EDITABLE_LIABILITY_FIELDS]).toEqual([
      "name",
      "balance",
      "interestRate",
      "monthlyPayment",
      "totalPayment",
      "balanceAsOfDate",
      "maturityDate",
      "propertyAddress",
    ]);
  });

  /**
   * Ruling 56 (Task 12b). `lender` is extracted, but it has no review column,
   * it is in NEITHER `commit/liabilities.ts` NOR `db/schema.ts`, and nothing
   * downstream reads it — so an accepted `edit_row` on it reported success
   * for a write the advisor could never see and the plan never stored. That
   * is the same lying-transcript defect Finding 2 is being fixed for, so the
   * field comes OFF the allowlist rather than gaining a fake column.
   *
   * Mutation this catches: putting `"lender"` back into
   * `EDITABLE_LIABILITY_FIELDS`.
   */
  it("refuses an edit to lender, which nothing downstream stores", () => {
    expect(() =>
      editRow(payload(), { rowId: HELOC_ID, field: "lender", value: "Rocket" }, NONE_COMMITTED),
    ).toThrow(/not editable/i);
  });
});

describe("merge_rows across both tables", () => {
  it("refuses to merge a liability into an account", () => {
    expect(() =>
      mergeRows(payload(), { keepRowId: ACCOUNT_ID, mergeRowId: MORTGAGE_ID }, NONE_COMMITTED),
    ).toThrow(/different tables|belong in different tables|cannot merge a debt/i);
  });

  it("refuses to merge an account into a liability", () => {
    expect(() =>
      mergeRows(payload(), { keepRowId: MORTGAGE_ID, mergeRowId: ACCOUNT_ID }, NONE_COMMITTED),
    ).toThrow(/different tables|belong in different tables|cannot merge a debt/i);
  });

  it("merges two liability rows, retiring the folded one into excludedRows", () => {
    const out = mergeRows(
      payload(),
      { keepRowId: MORTGAGE_ID, mergeRowId: HELOC_ID },
      NONE_COMMITTED,
    );
    expect(out.payload.liabilities).toHaveLength(1);
    expect(out.payload.liabilities![0].__rowId).toBe(MORTGAGE_ID);
    // The kept row wins on a conflict (`balance`), the retired row's unique
    // field backfills (`lender`).
    expect(out.payload.liabilities![0].balance).toBe(412_000);
    expect(out.payload.liabilities![0].lender).toBe("Third Federal");
    expect(out.payload.accounts).toHaveLength(1);
    expect(out.excludedRows?.[0].row.__rowId).toBe(HELOC_ID);
    expect(out.excludedRows?.[0].irreversible).toBe(true);
  });

  it("refuses to merge a committed liability row", () => {
    expect(() =>
      mergeRows(payload(), { keepRowId: MORTGAGE_ID, mergeRowId: HELOC_ID }, new Set([HELOC_ID])),
    ).toThrow(/already been committed/i);
  });
});

describe("drop_row across both tables", () => {
  it("drops a liability row and excludes it", () => {
    const out = dropRow(
      payload(),
      { rowId: MORTGAGE_ID, reason: "duplicate" },
      NONE_COMMITTED,
    );
    expect(out.payload.liabilities).toHaveLength(1);
    expect(out.payload.liabilities![0].__rowId).toBe(HELOC_ID);
    expect(out.payload.accounts).toHaveLength(1);
    expect(out.excludedRows).toHaveLength(1);
    expect(out.excludedRows?.[0].row.__rowId).toBe(MORTGAGE_ID);
    expect(out.excludedRows?.[0].reason).toBe("duplicate");
  });

  it("refuses to drop a committed liability row", () => {
    expect(() =>
      dropRow(payload(), { rowId: MORTGAGE_ID, reason: "duplicate" }, new Set([MORTGAGE_ID])),
    ).toThrow(/already been committed/i);
  });
});

/**
 * Ruling 49. `explain` resolves by row id and writes nothing, and a liability
 * carries `__provenance` exactly like an account — so an advisor asking where
 * the mortgage balance came from must get the document, not `Unknown row id`
 * listing only account ids. That dead-end is verbatim the retry loop
 * `findRowIndex`'s own docblock was written to prevent.
 */
describe("explain reaches a liability row", () => {
  it("cites the source document for a liability", () => {
    const before = payload();
    const out = explain(before, { rowId: MORTGAGE_ID }, { f1: "wells-fargo-mortgage.pdf" });
    expect(out.summary).toContain("Mortgage");
    expect(out.summary).toContain("wells-fargo-mortgage.pdf");
    expect(out.summary).toContain("pages 1–2");
    // Read-only: the same payload reference back, never a copy — `runTurn`
    // decides `payloadMutated` on reference inequality alone.
    expect(out.payload).toBe(before);
  });

  it("says so when a liability has no recorded source", () => {
    const out = explain(payload(), { rowId: HELOC_ID }, {});
    expect(out.summary).toMatch(/HELOC.*no recorded source document/i);
  });
});

/**
 * Ruling 49's other half: holdings are an ACCOUNT concept — a debt has no
 * positions — so the three holdings tools stay accounts-only and their
 * unknown-id error is right to list only account ids. Pinned so a later
 * "widen everything" sweep cannot quietly make a liability addressable by a
 * tool that would then write `holdings` onto a debt row.
 */
describe("the holdings tools stay accounts-only", () => {
  it("does not resolve a liability id, and lists only account ids", () => {
    let thrown: unknown;
    try {
      editHolding(
        payload(),
        { rowId: MORTGAGE_ID, holdingId: "h1", field: "shares", value: 1 },
        NONE_COMMITTED,
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toMatch(/Unknown row id/i);
    expect(message).toContain(ACCOUNT_ID);
    // The id it was ASKED for is quoted back in the message, so its presence
    // proves nothing. `HELOC_ID` was never named by the call — if it shows up,
    // the list of ids offered has become table-blind.
    expect(message).not.toContain(HELOC_ID);
  });
});
