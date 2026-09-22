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

/**
 * ── Final review I3 ─────────────────────────────────────────────────────
 *
 * `splitMortgageEscrow` runs ONCE, inside `mergeAcrossFiles`. Nothing re-ran
 * it after a chat edit — but the liabilities table's "Escrow → property tax"
 * column recomputes LIVE from the debt row on every render, and its docblock
 * promised the advisor "the figure the import will actually write onto the
 * property". So correcting P&I in the chat moved the COLUMN while the account
 * row kept the OLD `annualPropertyTax`, and `commitAccounts` wrote that one.
 * The column became a lie in exactly the direction this branch exists to
 * close, and it is the ONLY correction path for the extractor's P&I misread.
 *
 * ⚠️ Ruling 70: the obvious fix — re-run `splitMortgageEscrow` — is INERT.
 * Its guard is `target.annualPropertyTax ??= annual`, so after the first merge
 * the property already carries a figure and the re-run assigns nothing at all.
 *
 * The rule implemented instead: overwrite only when the stored figure equals
 * what the PRE-EDIT payment derived. That equality proves the figure was
 * derived by the split rather than asserted by a document.
 */
describe("edit_row keeps the derived property tax in step with the payment", () => {
  const PROPERTY_ID = "account:oak#f1:0";
  const DEBT_ID = "liability:oak-mortgage#f1:0";

  /** $2,600 PITI − $2,100 P&I = $500/mo escrow = $6,000/yr, the stored figure. */
  const escrowPayload = (over: {
    annualPropertyTax?: number;
    totalPayment?: number;
    monthlyPayment?: number;
  } = {}): PersistedImportPayload =>
    ({
      accounts: [
        {
          __rowId: PROPERTY_ID,
          name: "12 Oak Street",
          category: "real_estate",
          subType: "primary_residence",
          propertyAddress: "12 Oak Street",
          value: 640_000,
          ...("annualPropertyTax" in over
            ? { annualPropertyTax: over.annualPropertyTax }
            : { annualPropertyTax: 6_000 }),
        },
      ],
      liabilities: [
        {
          __rowId: DEBT_ID,
          name: "Mortgage",
          balance: 412_000,
          monthlyPayment: "monthlyPayment" in over ? over.monthlyPayment : 2_100,
          totalPayment: "totalPayment" in over ? over.totalPayment : 2_600,
          propertyAddress: "12 Oak Street",
        },
      ],
    }) as unknown as PersistedImportPayload;

  it("moves the property's tax when the P&I is corrected", () => {
    // $2,600 − $2,000 = $600/mo → $7,200/yr.
    const out = editRow(
      escrowPayload(),
      { rowId: DEBT_ID, field: "monthlyPayment", value: 2_000 },
      NONE_COMMITTED,
    );
    expect(out.payload.accounts![0].annualPropertyTax).toBe(7_200);
  });

  it("moves it when the total payment is corrected", () => {
    // $2,800 − $2,100 = $700/mo → $8,400/yr.
    const out = editRow(
      escrowPayload(),
      { rowId: DEBT_ID, field: "totalPayment", value: 2_800 },
      NONE_COMMITTED,
    );
    expect(out.payload.accounts![0].annualPropertyTax).toBe(8_400);
  });

  /**
   * Direction one of the derived-vs-asserted rule. $9,999 is not what the
   * pre-edit payment derived ($6,000), which is the proof a document asserted
   * it — so the advisor's payment correction must not overwrite it.
   */
  it("leaves a tax the document asserted alone", () => {
    const out = editRow(
      escrowPayload({ annualPropertyTax: 9_999 }),
      { rowId: DEBT_ID, field: "monthlyPayment", value: 2_000 },
      NONE_COMMITTED,
    );
    expect(out.payload.accounts![0].annualPropertyTax).toBe(9_999);
  });

  /**
   * Direction two. `undefined === undefined` — nothing derived a figure
   * before, so nothing is being overwritten, and the hole is filled.
   */
  it("fills a hole when the statement first becomes able to support a figure", () => {
    const out = editRow(
      escrowPayload({ annualPropertyTax: undefined, totalPayment: undefined }),
      { rowId: DEBT_ID, field: "totalPayment", value: 2_600 },
      NONE_COMMITTED,
    );
    expect(out.payload.accounts![0].annualPropertyTax).toBe(6_000);
  });

  /**
   * The same rule read backwards: once the corrected payments no longer
   * support ANY escrow, the derived figure has to go. A guard that only ever
   * wrote a defined number would leave $6,000 of property tax on a house whose
   * mortgage says the payment is all principal and interest.
   */
  it("clears the derived figure when the corrected payments no longer support one", () => {
    const out = editRow(
      escrowPayload(),
      { rowId: DEBT_ID, field: "totalPayment", value: 2_100 },
      NONE_COMMITTED,
    );
    expect(out.payload.accounts![0].annualPropertyTax).toBeUndefined();
  });

  /**
   * ── Ruling 71: `propertyAddress` is EXCLUDED, and M8 is filed ─────────
   *
   * `splitMortgageEscrow` SYNTHESIZES and pushes a property when it finds
   * none, carrying no `__rowId`/`match`/`__provenance` — those are stamped by
   * hand in `merge-across-files.ts`. A chat-time recompute that appended would
   * put an UNCOMMITTABLE row on the advisor's table, a new defect of exactly
   * the class this branch closes. An address edit also changes WHICH property
   * is the target, so the recompute has no well-defined row.
   */
  it("appends no property when a payment edit finds none to update", () => {
    const orphaned = escrowPayload();
    (orphaned.accounts as unknown[])!.length = 0;
    const out = editRow(
      orphaned,
      { rowId: DEBT_ID, field: "monthlyPayment", value: 2_000 },
      NONE_COMMITTED,
    );
    expect(out.payload.accounts).toEqual([]);
  });

  /**
   * ⚠️ A REGRESSION GUARD that does NOT discriminate `ESCROW_INPUT_FIELDS`,
   * and is kept anyway — stated here rather than left for a reader to
   * discover. Measured: an address edit leaves both payments untouched, so
   * `annualEscrow(before).annual === annualEscrow(after).annual` and the
   * recompute early-returns before it reaches the property lookup at all.
   * Adding "propertyAddress" back to the allowlist is therefore a NO-OP and
   * this test would stay green through it. What it does pin is the OUTCOME
   * Ruling 71 cares about — an address edit leaves the accounts array exactly
   * as it was, and in particular does not grow an uncommittable synthesized
   * row. The test above is the one that discriminates the append.
   */
  it("leaves the accounts array untouched on a propertyAddress edit", () => {
    const before = escrowPayload();
    const out = editRow(
      before,
      { rowId: DEBT_ID, field: "propertyAddress", value: "99 Elm Street" },
      NONE_COMMITTED,
    );
    expect(out.payload.accounts).toHaveLength(1);
    expect(out.payload.accounts).toEqual(before.accounts);
  });

  /**
   * A committed property is already in the client's plan and nothing on this
   * surface can update it — `assertNotCommitted` refuses a direct edit for
   * exactly that reason. Rewriting its payload figure here would only make the
   * table disagree with the database, which is this finding's own defect one
   * row over.
   */
  it("leaves a property that is already committed alone", () => {
    const out = editRow(
      escrowPayload(),
      { rowId: DEBT_ID, field: "monthlyPayment", value: 2_000 },
      new Set([PROPERTY_ID]),
    );
    expect(out.payload.accounts![0].annualPropertyTax).toBe(6_000);
  });

  /** The debt's own edit still lands, whatever the property did. */
  it("still writes the edited field on the debt itself", () => {
    const out = editRow(
      escrowPayload(),
      { rowId: DEBT_ID, field: "monthlyPayment", value: 2_000 },
      NONE_COMMITTED,
    );
    expect(out.payload.liabilities![0].monthlyPayment).toBe(2_000);
  });
});
