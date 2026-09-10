import { describe, it, expect, vi, beforeEach } from "vitest";

// `reread_document` is the only tool that does IO (a DB lookup for the
// file's blob URL, then a blob download, plus — since review round 1's
// Critical fix — a possible `extractDocument` re-extraction) — mocked here
// the same way `chat/extract/route.ts`'s gate.test.ts mocks them, so this
// stays a plain unit test with no real Postgres/Blob/Azure call.
let fileRow: { blobUrl: string } | undefined = { blobUrl: "https://blob/f1.pdf" };

// Important 2: spy on the REAL `eq`/`and` (delegating to them, not replacing
// them) so a test can assert the file lookup was actually built with an
// `importId` condition — a behavioral fake `@/db` can't prove this itself,
// since it doesn't interpret the query it's handed.
const eqCalls: Array<[unknown, unknown]> = [];
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (...args: [unknown, unknown]) => {
      eqCalls.push(args);
      return actual.eq(...(args as Parameters<typeof actual.eq>));
    },
  };
});

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(fileRow ? [fileRow] : []),
        }),
      }),
    }),
  },
}));

const downloadImportFile = vi.fn(async () => Buffer.from("statement bytes"));
vi.mock("@/lib/imports/blob", () => ({
  downloadImportFile: () => downloadImportFile(),
}));

const extractDocument = vi.fn();
vi.mock("@/lib/extraction/extract", () => ({
  extractDocument: (...a: Parameters<typeof extractDocument>) => extractDocument(...a),
}));

import {
  editRow,
  mergeRows,
  dropRow,
  explain,
  rereadDocument,
  EDITABLE_ACCOUNT_FIELDS,
  type RereadModel,
} from "@/lib/statement-chat/tools";
import { clientImportFiles } from "@/db/schema";
import type { PersistedImportPayload } from "@/lib/imports/types";
import type { ExtractionResult } from "@/lib/extraction/types";

const payload = (): PersistedImportPayload =>
  ({
    accounts: [
      { __rowId: "r1", name: "IRA", value: 10_000, basis: 5_000,
        __provenance: { sourceFileId: "f1", section: "accounts", pageRange: [2, 3] } },
      { __rowId: "r2", name: "IRA", value: 10_000, custodian: "Schwab" },
    ],
  }) as unknown as PersistedImportPayload;

/** Nothing committed yet — the state every test below except the C3 block
 *  is about. Named rather than inlined so `new Set()` at twenty call sites
 *  doesn't read as a meaningful argument each time. */
const NONE_COMMITTED: ReadonlySet<string> = new Set<string>();

beforeEach(() => {
  vi.clearAllMocks();
  fileRow = { blobUrl: "https://blob/f1.pdf" };
  eqCalls.length = 0;
});

describe("statement chat tools", () => {
  // Mutation this catches: editRow writing `args.value` under a hardcoded
  // key (e.g. always "value") instead of `[args.field]` — the "basis
  // changed, value untouched" pair would then fail on whichever half the
  // mutation broke.
  it("edit_row writes only the named field on the named row", () => {
    const next = editRow(payload(), { rowId: "r1", field: "basis", value: 10_010.17 }, NONE_COMMITTED);
    expect(next.payload.accounts![0].basis).toBe(10_010.17);
    expect(next.payload.accounts![0].value).toBe(10_000);
    expect(next.payload.accounts![1]).toEqual(payload().accounts![1]);
  });

  // Mutation this catches: dropping the `findRowIndex` throw (e.g.
  // `?? -1` silently falling through to writing index -1).
  it("edit_row rejects a rowId that is not in the payload", () => {
    expect(() => editRow(payload(), { rowId: "nope", field: "value", value: 1 }, NONE_COMMITTED))
      .toThrow(/unknown row/i);
  });

  // Mutation this catches: Ruling 50's allowlist regressing to a denylist —
  // this specific field (`__rowId`) is never named as "banned" anywhere, so
  // a denylist that only excludes a hardcoded few (e.g. `__provenance`,
  // `match`) would let this write through instead of rejecting it.
  it("edit_row rejects a field that is not an editable column", () => {
    expect(() => editRow(payload(), { rowId: "r1", field: "__rowId", value: "x" }, NONE_COMMITTED))
      .toThrow(/not editable/i);
  });

  // Mutation this catches: every field on `EDITABLE_ACCOUNT_FIELDS` must
  // actually be accepted for a domain-VALID value — a list that's merely
  // non-empty (but missing a real column) would pass without this one.
  // Review round 1, Important 5: uses a real value per field's domain, not
  // a blanket "x" — the ORIGINAL version of this test used "x" for every
  // field, including the two money columns, which is exactly the gap that
  // let a non-numeric `value`/`basis` write through uncaught.
  it("edit_row accepts a domain-valid value for every column on the allowlist", () => {
    const validValues: Record<(typeof EDITABLE_ACCOUNT_FIELDS)[number], unknown> = {
      name: "New Name",
      value: 1_234.56,
      basis: 500,
      accountNumberLast4: "1234",
      owner: "client",
      custodian: "Fidelity",
      category: "retirement",
      subType: "roth_ira",
    };
    for (const field of EDITABLE_ACCOUNT_FIELDS) {
      expect(() => editRow(payload(), { rowId: "r1", field, value: validValues[field] }, NONE_COMMITTED)).not.toThrow();
    }
  });

  // Review round 1, Important 5 — THE test that matters: a money field must
  // reject a non-numeric value. Mutation this catches: `isValidFieldValue`
  // regressing to "any scalar" (the ORIGINAL, review-flagged behavior) —
  // this is the exact case (`basis: "x"`) the review called out as silently
  // accepted.
  it("edit_row rejects a non-numeric value for a money field", () => {
    expect(() => editRow(payload(), { rowId: "r1", field: "basis", value: "x" }, NONE_COMMITTED))
      .toThrow(/must be a finite number/i);
    expect(() => editRow(payload(), { rowId: "r1", field: "value", value: "12000" }, NONE_COMMITTED))
      .toThrow(/must be a finite number/i);
  });

  it("edit_row rejects a non-finite number for a money field", () => {
    expect(() => editRow(payload(), { rowId: "r1", field: "basis", value: Infinity }, NONE_COMMITTED))
      .toThrow(/must be a finite number/i);
    expect(() => editRow(payload(), { rowId: "r1", field: "basis", value: NaN }, NONE_COMMITTED))
      .toThrow(/must be a finite number/i);
  });

  it("edit_row rejects an owner value outside client/spouse/joint", () => {
    expect(() => editRow(payload(), { rowId: "r1", field: "owner", value: "trust" }, NONE_COMMITTED))
      .toThrow(/must be one of/i);
  });

  it("edit_row rejects a category value outside the real enum", () => {
    expect(() => editRow(payload(), { rowId: "r1", field: "category", value: "crypto" }, NONE_COMMITTED))
      .toThrow(/must be one of/i);
  });

  it("edit_row rejects a subType value outside the real enum", () => {
    expect(() => editRow(payload(), { rowId: "r1", field: "subType", value: "not_a_real_subtype" }, NONE_COMMITTED))
      .toThrow(/must be one of/i);
  });

  // Mutation this catches: `unionAccountFields` backfilling from `keep` into
  // `merge` instead of the other way — `custodian` would then be dropped
  // instead of surviving, since only r2 (the retired row) carries it.
  it("merge_rows unions two rows and retires the second id", () => {
    const next = mergeRows(payload(), { keepRowId: "r1", mergeRowId: "r2" }, NONE_COMMITTED);
    expect(next.payload.accounts!).toHaveLength(1);
    expect(next.payload.accounts![0].__rowId).toBe("r1");
    // r2's unique field survives the union.
    expect(next.payload.accounts![0].custodian).toBe("Schwab");
  });

  // Mutation this catches: `unionAccountFields` overwriting a field `keep`
  // already has (e.g. dropping the `?? null` undefined/null guard) — `basis`
  // (only on r1) would then still work, but a conflicting field like `value`
  // (present on both, same number here) proves the base actually wins
  // rather than merely "some value survives".
  it("merge_rows keeps the base row's value on a field both rows carry", () => {
    const next = mergeRows(payload(), { keepRowId: "r1", mergeRowId: "r2" }, NONE_COMMITTED);
    expect(next.payload.accounts![0].value).toBe(10_000);
    expect(next.payload.accounts![0].basis).toBe(5_000);
  });

  it("merge_rows rejects merging a row into itself", () => {
    expect(() => mergeRows(payload(), { keepRowId: "r1", mergeRowId: "r1" }, NONE_COMMITTED))
      .toThrow(/itself/i);
  });

  // Review round 1, Important 4 — THE test that matters: merge is the one
  // irreversible tool. Mutation this catches: dropping `excludedRows` from
  // `mergeRows`'s return (reverting to the reviewed behavior) — the retired
  // row's conflicting fields would then simply be gone with no record.
  it("merge_rows records the retired row in excludedRows, the same as drop_row", () => {
    const next = mergeRows(payload(), { keepRowId: "r1", mergeRowId: "r2" }, NONE_COMMITTED);
    expect(next.excludedRows).toHaveLength(1);
    expect(next.excludedRows?.[0].row).toMatchObject({ __rowId: "r2", custodian: "Schwab" });
    expect(next.excludedRows?.[0].reason).toMatch(/merged into/i);
  });

  // Ruling 96 (Task 11b fix round 1) — the discriminator lives at THIS
  // producer, not inferred from `reason`'s prose downstream. Mutation this
  // catches: dropping `irreversible: true` from `mergeRows`'s returned
  // excludedRows entry — a surface gating "Include anyway" off this flag
  // would then wrongly let the advisor restore a row whose data was already
  // folded into the surviving row, double-counting the account.
  it("merge_rows marks its retired row irreversible — the discriminator lives at the producer", () => {
    const next = mergeRows(payload(), { keepRowId: "r1", mergeRowId: "r2" }, NONE_COMMITTED);
    expect(next.excludedRows?.[0].irreversible).toBe(true);
  });

  // Review round 1, Important 4 — the backfill must never touch internal
  // annotations. Mutation this catches: the ORIGINAL `unionAccountFields`
  // iterating every key of `other` (including `match`/`reconciliation`)
  // instead of only `EDITABLE_ACCOUNT_FIELDS` — `keep`'s own match status
  // would then be silently overwritten by `merge`'s.
  it("merge_rows never backfills match/reconciliation from the retired row", () => {
    const withMatch = {
      accounts: [
        { __rowId: "r1", name: "IRA", value: 10_000 },
        {
          __rowId: "r2",
          name: "IRA",
          value: 10_000,
          match: { kind: "exact", existingId: "acct-1" },
          reconciliation: { supersededBy: "r9", reason: "dup" },
        },
      ],
    } as unknown as PersistedImportPayload;
    const next = mergeRows(withMatch, { keepRowId: "r1", mergeRowId: "r2" }, NONE_COMMITTED);
    expect(next.payload.accounts![0].match).toBeUndefined();
    expect(next.payload.accounts![0].reconciliation).toBeUndefined();
  });

  // The one exception: provenance backfills ONLY when the base has none at
  // all — useful for a later `explain` call, unlike match/reconciliation.
  it("merge_rows backfills provenance only when the base row has none", () => {
    const withProvenance = {
      accounts: [
        { __rowId: "r1", name: "IRA", value: 10_000 },
        {
          __rowId: "r2",
          name: "IRA",
          value: 10_000,
          __provenance: { sourceFileId: "f9", section: "accounts" },
        },
      ],
    } as unknown as PersistedImportPayload;
    const next = mergeRows(withProvenance, { keepRowId: "r1", mergeRowId: "r2" }, NONE_COMMITTED);
    expect(next.payload.accounts![0].__provenance).toEqual({ sourceFileId: "f9", section: "accounts" });
  });

  // Mutation this catches: the FOURTH excluded shape (C3) regressing to a
  // flat `{ __rowId, __excludedReason }` — `.row` / `.reason` would then be
  // `undefined` instead of matching.
  it("drop_row moves the row to excludedRows with its reason, never deleting it", () => {
    const next = dropRow(payload(), { rowId: "r2", reason: "duplicate of r1" }, NONE_COMMITTED);
    expect(next.payload.accounts!.map((r) => r.__rowId)).toEqual(["r1"]);
    expect(next.excludedRows?.[0].row).toMatchObject({ __rowId: "r2" });
    expect(next.excludedRows?.[0].reason).toBe("duplicate of r1");
  });

  it("drop_row rejects an empty reason", () => {
    expect(() => dropRow(payload(), { rowId: "r2", reason: "   " }, NONE_COMMITTED)).toThrow(/reason/i);
  });

  // --- Final review, C3: a committed row is off limits to every WRITE ---
  //
  // Once a row is committed, `commitAccounts` has written a real account into
  // the household and this surface has no path that updates it. Editing one
  // changes only the on-screen table (and `entity-table.tsx` then leaves its
  // Commit button permanently disabled, so the correction can never reach the
  // plan); merging one leaves the plan holding BOTH accounts for the same
  // real account. Refusing is the correct answer, not the timid one.
  describe("a committed row (C3)", () => {
    const COMMITTED_R1: ReadonlySet<string> = new Set(["r1"]);

    it("edit_row refuses a committed row, naming it and saying why", () => {
      expect(() =>
        editRow(payload(), { rowId: "r1", field: "value", value: 99 }, COMMITTED_R1),
      ).toThrow(/already been committed/i);
      expect(() =>
        editRow(payload(), { rowId: "r1", field: "value", value: 99 }, COMMITTED_R1),
      ).toThrow(/IRA/);
    });

    it("merge_rows refuses when the RETIRED row is committed", () => {
      // The double-count sequence from the review: commit r1, then fold r1
      // into r2, then commit r2 — the plan ends up holding both.
      expect(() =>
        mergeRows(payload(), { keepRowId: "r2", mergeRowId: "r1" }, COMMITTED_R1),
      ).toThrow(/already been committed/i);
    });

    it("merge_rows refuses when the SURVIVING row is committed", () => {
      expect(() =>
        mergeRows(payload(), { keepRowId: "r1", mergeRowId: "r2" }, COMMITTED_R1),
      ).toThrow(/already been committed/i);
    });

    it("drop_row refuses a committed row", () => {
      expect(() =>
        dropRow(payload(), { rowId: "r1", reason: "not the client's" }, COMMITTED_R1),
      ).toThrow(/already been committed/i);
    });

    // The other half — the guard must not have turned the tools off.
    it("still accepts an uncommitted row while another row is committed", () => {
      expect(
        editRow(payload(), { rowId: "r2", field: "value", value: 99 }, COMMITTED_R1)
          .payload.accounts![1].value,
      ).toBe(99);
      expect(
        dropRow(payload(), { rowId: "r2", reason: "duplicate" }, COMMITTED_R1)
          .payload.accounts!.map((r) => r.__rowId),
      ).toEqual(["r1"]);
      expect(
        mergeRows(
          { accounts: [{ __rowId: "r2", name: "A" }, { __rowId: "r3", name: "B", basis: 7 }] } as never,
          { keepRowId: "r2", mergeRowId: "r3" },
          COMMITTED_R1,
        ).payload.accounts,
      ).toHaveLength(1);
    });

    // Read-only tools are deliberately unaffected: neither writes a row, and
    // "where did this committed number come from?" is a fair question.
    it("explain still answers for a committed row", () => {
      expect(explain(payload(), { rowId: "r1" }, { f1: "f1.pdf" }).summary).toMatch(/f1\.pdf/);
    });
  });

  // Mutation this catches: the with-range branch (C1's fixture case) —
  // dropping the page-range clause entirely would fail this one while
  // leaving the absent-range test (below) green.
  it("explain returns the source file and page from provenance", () => {
    const result = explain(payload(), { rowId: "r1" }, { f1: "f1.pdf" });
    expect(result.summary).toMatch(/f1.*pages? 2\s*[–-]\s*3/i);
  });

  // C1 / Ruling 21 — THE test that matters: `merge-across-files.ts`, the
  // path every real chat-surface row comes through, never sets a page
  // range. Mutation this catches: unconditionally rendering a page clause
  // (e.g. `pages ${pageRange?.[0]} – ${pageRange?.[1]}` without the
  // presence check) would render "pages undefined – undefined" here.
  it("explain cites the file name with no page range when none was recorded (the real merge-across-files path)", () => {
    const noRangePayload = {
      accounts: [
        {
          __rowId: "r3",
          name: "Brokerage",
          value: 5_000,
          __provenance: { sourceFileId: "f2", section: "accounts" },
        },
      ],
    } as never;
    const result = explain(noRangePayload, { rowId: "r3" }, { f2: "schwab-statement.pdf" });
    expect(result.summary).toContain("schwab-statement.pdf");
    expect(result.summary).not.toMatch(/undefined/i);
    expect(result.summary).not.toMatch(/page/i);
  });

  it("explain falls back to the raw id when the file name map has no entry", () => {
    const result = explain(payload(), { rowId: "r1" }, {});
    expect(result.summary).toContain("f1");
  });

  // ---------------------------------------------------------------------
  // reread_document
  // ---------------------------------------------------------------------

  const fakeModel: RereadModel = {
    invoke: async () => ({
      content: JSON.stringify({ rowId: "r1", field: "basis", value: 10_010.17 }),
    }),
  };

  /** One entry of `payloadJson.fileResults` in the shape the extract route
   *  really persists: keyed by source file id, each value an
   *  `ExtractionResult` carrying its own `fileName` and (usually) the
   *  redacted document text captured at extraction time. Omitting `text`
   *  models a file extracted before that field existed — the only case that
   *  falls back to the DB/blob/re-extraction path. */
  function fileResult(fileName: string, text?: string): ExtractionResult {
    return {
      documentType: "account_statement",
      fileName,
      extracted: {
        accounts: [], incomes: [], expenses: [], liabilities: [], entities: [],
        lifePolicies: [], wills: [], savings: [], goals: [],
      },
      warnings: [],
      promptVersion: "v",
      ...(text === undefined ? {} : { text }),
    } as unknown as ExtractionResult;
  }

  /** A fresh `ExtractionResult` fixture carrying real stored text — the
   *  common path after the Critical fix, no DB/blob/extractDocument call
   *  needed. */
  function fileResultsWithText(text: string): Record<string, ExtractionResult> {
    return { f1: fileResult("f1.pdf", text) };
  }

  const STATEMENT_TEXT =
    "Schwab Traditional IRA statement. Roth basis as of statement date: $12,345.67. Value: $10,000.00.";

  /**
   * CRITICAL FIX proof: the "model" here doesn't answer from thin air — it
   * greps the PROMPT it actually received for the one fact this test
   * controls, and only that fact. If `rereadDocument` stops embedding the
   * real document text in the prompt, this regex never matches and the
   * double returns a sentinel (`-999`) instead of the real figure — the
   * assertion below reddens exactly when the document's content stops
   * reaching the model, which is the proof the review asked for.
   */
  function documentGroundedModel(): RereadModel {
    return {
      invoke: async (prompt: string) => {
        const match = prompt.match(/Roth basis as of statement date: \$([\d,]+\.\d{2})/);
        const value = match ? Number(match[1].replace(/,/g, "")) : -999;
        return { content: JSON.stringify({ rowId: "r1", field: "basis", value }) };
      },
    };
  }

  it("CRITICAL FIX: grounds the proposal in the real document text, not fabricated row data", async () => {
    const result = await rereadDocument(
      payload(),
      { fileName: "f1.pdf", question: "what is the Roth basis?" },
      documentGroundedModel(),
      { importId: "i1", fileResults: fileResultsWithText(STATEMENT_TEXT) },
    );
    // 12,345.67 comes ONLY from the statement text, never from the row
    // (whose starting basis is 5,000) — proves the text actually reached
    // the model rather than the model guessing from row data.
    //
    // Asserted on `summary` since I3: the structured `proposal` field is
    // gone (nothing ever read it) and this sentence is now the only thing
    // that carries the correction.
    expect(result.summary).toContain("set basis to 12,345.67");
    expect(result.summary).toContain("r1");
    // Never touches the DB/blob when stored text is already present.
    expect(vi.mocked(downloadImportFile)).not.toHaveBeenCalled();
    expect(extractDocument).not.toHaveBeenCalled();
  });

  it("falls back to downloading and re-extracting when no stored text exists (a legacy row)", async () => {
    extractDocument.mockResolvedValue({
      documentType: "account_statement",
      fileName: "f1.pdf",
      extracted: { accounts: [], incomes: [], expenses: [], liabilities: [], entities: [], lifePolicies: [], wills: [], savings: [], goals: [] },
      warnings: [],
      promptVersion: "v",
      text: STATEMENT_TEXT,
    });

    // Nothing is stored for this file, so `describeRows` shows the model
    // `source=f1` — the raw id, since there is no name to substitute. Ruling
    // 103's belt-and-braces rule resolves that echoed id to itself rather
    // than punishing the model for passing back the only thing it was shown.
    const result = await rereadDocument(
      payload(),
      { fileName: "f1", question: "what is the Roth basis?" },
      documentGroundedModel(),
      { importId: "i1", fileResults: {} }, // no stored text at all
    );

    expect(vi.mocked(downloadImportFile)).toHaveBeenCalledTimes(1);
    expect(extractDocument).toHaveBeenCalledTimes(1);
    // The buffer `downloadImportFile` actually returned is what reached
    // `extractDocument` — not an empty/placeholder buffer.
    const [bufferArg] = extractDocument.mock.calls[0];
    expect(Buffer.isBuffer(bufferArg)).toBe(true);
    expect(bufferArg.toString()).toBe("statement bytes");
    expect(result.summary).toContain("set basis to 12,345.67");
  });

  // Important 2 — THE test that matters: the reviewer disproved the "closed
  // by construction" claim by reading the accounts-PATCH route, which
  // accepts arbitrary `payloadJson.accounts` with no row validation — a
  // foreign file id can be planted onto a row's `__provenance`. Mutation
  // this catches: dropping `eq(clientImportFiles.importId, ...)` from the
  // lookup — this asserts that condition was actually built, not merely
  // that SOME query ran.
  // Ruling 103 additionally: the query must be built from the RESOLVED id,
  // never from the name the model typed — a lookup keyed on
  // "fidelity-roth-jun2026.pdf" would match no row at all.
  it("scopes the file lookup by BOTH the resolved id and importId, not the name (Important 2)", async () => {
    extractDocument.mockResolvedValue(fileResult("fidelity-roth-jun2026.pdf", STATEMENT_TEXT));
    await rereadDocument(
      payload(),
      { fileName: "fidelity-roth-jun2026.pdf", question: "what is the Roth basis?" },
      fakeModel,
      // An entry with a name but NO stored text: resolvable by name, and it
      // still forces the DB-lookup fallback path.
      { importId: "import-abc", fileResults: { f1: fileResult("fidelity-roth-jun2026.pdf") } },
    );
    expect(eqCalls).toContainEqual([clientImportFiles.id, "f1"]);
    expect(eqCalls).toContainEqual([clientImportFiles.importId, "import-abc"]);
    // And the re-extraction is told the document's NAME, not its id.
    expect(extractDocument.mock.calls[0][1]).toBe("fidelity-roth-jun2026.pdf");
  });

  // Mutation this catches: `reread_document` writing straight to `payload`
  // instead of only DESCRIBING the correction — the `toEqual(payload())`
  // comparison against a FRESH fixture call (C10) would then fail because
  // the returned payload's `basis` would already be 10010.17.
  it("reread_document proposes a correction rather than applying one", async () => {
    const result = await rereadDocument(
      payload(),
      { fileName: "f1.pdf", question: "what is the Roth basis?" },
      fakeModel,
      { importId: "i1", fileResults: fileResultsWithText(STATEMENT_TEXT) },
    );
    // I3 — THE assertion that matters now that the correction travels only
    // in prose: the summary names the ROW as well as the field and value.
    // "set basis to 10,010.17" alone is ambiguous the instant a statement
    // has two accounts, and the advisor's "yes, apply that" has to be
    // unambiguous for the model's follow-up edit_row to hit the right row.
    expect(result.summary).toContain('"IRA"');
    expect(result.summary).toContain("r1");
    expect(result.summary).toContain("set basis to 10,010.17");
    // Still only a PROPOSAL: the payload is untouched until the advisor
    // accepts — compared against a FRESH payload(), not a mutated
    // reference (C10).
    expect(result.payload).toEqual(payload());
  });

  // Mutation this catches: dropping the candidate-row / fileId cross-check —
  // a model proposing a row from a DIFFERENT file than the one it was asked
  // to re-read would otherwise be accepted.
  it("reread_document rejects a proposal naming a row from a different file", async () => {
    const crossFileModel: RereadModel = {
      invoke: async () => ({ content: JSON.stringify({ rowId: "r2", field: "value", value: 1 }) }),
    };
    await expect(
      rereadDocument(
        payload(),
        { fileName: "f1.pdf", question: "?" },
        crossFileModel,
        { importId: "i1", fileResults: fileResultsWithText(STATEMENT_TEXT) },
      ),
    ).rejects.toThrow(/unknown row/i);
  });

  // Mutation this catches: dropping the allowlist check on the MODEL's own
  // proposal — Ruling 50 must hold for a proposed field too, not just a
  // directly-called edit_row.
  it("reread_document rejects a proposal naming a non-editable field", async () => {
    const badFieldModel: RereadModel = {
      invoke: async () => ({ content: JSON.stringify({ rowId: "r1", field: "__rowId", value: "x" }) }),
    };
    await expect(
      rereadDocument(
        payload(),
        { fileName: "f1.pdf", question: "?" },
        badFieldModel,
        { importId: "i1", fileResults: fileResultsWithText(STATEMENT_TEXT) },
      ),
    ).rejects.toThrow(/not editable/i);
  });

  // Important 5 applies to the model's own proposal too: a non-numeric
  // "basis" from the model must be rejected the same as one from edit_row.
  it("reread_document rejects a proposal with a value outside the field's domain", async () => {
    const badValueModel: RereadModel = {
      invoke: async () => ({ content: JSON.stringify({ rowId: "r1", field: "basis", value: "a lot" }) }),
    };
    await expect(
      rereadDocument(
        payload(),
        { fileName: "f1.pdf", question: "?" },
        badValueModel,
        { importId: "i1", fileResults: fileResultsWithText(STATEMENT_TEXT) },
      ),
    ).rejects.toThrow(/domain/i);
  });

  // ---------------------------------------------------------------------
  // Ruling 103: the tool takes the document's NAME, because the name is the
  // only identifier the model is ever shown. Before this, it took a
  // `sourceFileId` UUID that appears nowhere in the prompt or in any tool
  // result, so it threw "No rows in this import came from file …" on 100%
  // of real calls and the whole propose→approve→edit loop was dead.
  // ---------------------------------------------------------------------

  /** The message of the error a call rejects with — `.catch(e => e)` widens
   *  to `Error | ToolResult`, which vitest would run happily and `tsc` would
   *  reject. */
  async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
    try {
      await promise;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    throw new Error("Expected the call to reject, but it resolved.");
  }

  const SCHWAB_TEXT =
    "Schwab One Brokerage. Account value at period end: $20,500.00. No IRA basis is reported here.";

  /** Two documents in one import, keyed by source file id exactly as
   *  `payloadJson.fileResults` is. */
  function twoFileResults(): Record<string, ExtractionResult> {
    return {
      f1: fileResult("fidelity-roth-jun2026.pdf", STATEMENT_TEXT),
      f2: fileResult("schwab-brokerage-jun2026.pdf", SCHWAB_TEXT),
    };
  }

  const twoFilePayload = (): PersistedImportPayload =>
    ({
      accounts: [
        { __rowId: "r1", name: "Roth IRA", value: 10_000, basis: 5_000,
          __provenance: { sourceFileId: "f1", section: "accounts" } },
        { __rowId: "r9", name: "Brokerage", value: 20_000,
          __provenance: { sourceFileId: "f2", section: "accounts" } },
      ],
    }) as unknown as PersistedImportPayload;

  // THE test that matters for Ruling 103: the name picks out the RIGHT
  // document. Mutation this catches: resolving to the first (or any fixed)
  // entry of `fileResults` instead of the named one — the model would then
  // be handed the Fidelity statement and the Fidelity rows while the
  // advisor asked about the Schwab one.
  it("reread_document resolves the document by the NAME the model is actually shown", async () => {
    const prompts: string[] = [];
    const capturingModel: RereadModel = {
      invoke: async (prompt: string) => {
        prompts.push(prompt);
        return { content: JSON.stringify({ rowId: "r9", field: "value", value: 20_500 }) };
      },
    };

    const result = await rereadDocument(
      twoFilePayload(),
      { fileName: "schwab-brokerage-jun2026.pdf", question: "what is the ending value?" },
      capturingModel,
      { importId: "i1", fileResults: twoFileResults() },
    );

    // The named document's text reached the model, and the other one's did not.
    expect(prompts[0]).toContain(SCHWAB_TEXT);
    expect(prompts[0]).not.toContain(STATEMENT_TEXT);
    // ...and so did only that document's rows.
    expect(prompts[0]).toContain("rowId r9");
    expect(prompts[0]).not.toContain("rowId r1");
    expect(result.summary).toContain("r9");
    expect(result.summary).toContain("set value to 20,500");
  });

  // A model retyping a name rarely matches byte-for-byte. Mutation this
  // catches: dropping the trim/lowercase fold and comparing raw strings.
  it("reread_document resolves a name whose case and surrounding whitespace differ", async () => {
    const result = await rereadDocument(
      payload(),
      { fileName: "  F1.PDF  ", question: "what is the Roth basis?" },
      documentGroundedModel(),
      { importId: "i1", fileResults: fileResultsWithText(STATEMENT_TEXT) },
    );
    expect(result.summary).toContain("set basis to 12,345.67");
  });

  // Ambiguity ruling: two files under one name must NOT be silently picked
  // between — that would re-read the wrong statement and propose a
  // correction off the wrong document. Mutation this catches: taking
  // `matches[0]` when more than one matched.
  it("reread_document refuses to guess when two documents in the import share a name", async () => {
    const message = await rejectionMessage(
      rereadDocument(
        payload(),
        { fileName: "statement.pdf", question: "?" },
        fakeModel,
        {
          importId: "i1",
          fileResults: {
            f1: fileResult("statement.pdf", STATEMENT_TEXT),
            f2: fileResult("Statement.PDF", SCHWAB_TEXT),
          },
        },
      ),
    );

    expect(message).toMatch(/2 documents named "statement\.pdf"/i);
    // The collision is named, and the ids are offered as the way out — they
    // resolve to themselves.
    expect(message).toContain("f1");
    expect(message).toContain("f2");
  });

  // Not-found ruling: the error has to give the model somewhere to go.
  // Mutation this catches: reverting to a bare "no rows came from …" dead
  // end that lists nothing.
  it("reread_document lists the documents this import DOES have when the name matches nothing", async () => {
    const message = await rejectionMessage(
      rereadDocument(
        payload(),
        { fileName: "vanguard-2025.pdf", question: "?" },
        fakeModel,
        { importId: "i1", fileResults: fileResultsWithText(STATEMENT_TEXT) },
      ),
    );

    expect(message).toMatch(/no document in this import is named "vanguard-2025\.pdf"/i);
    expect(message).toContain("f1.pdf");
    expect(vi.mocked(downloadImportFile)).not.toHaveBeenCalled();
  });

  // The provenance pre-check survives the rename: a document this import
  // really owns, but that no row came from, still stops before any IO.
  // Mutation this catches: dropping the `candidates.length === 0` throw once
  // resolution moved ahead of it.
  it("reread_document rejects a document in this import that no row came from", async () => {
    await expect(
      rereadDocument(
        payload(),
        { fileName: "cover-letter.pdf", question: "?" },
        fakeModel,
        {
          importId: "i1",
          fileResults: {
            f1: fileResult("f1.pdf", STATEMENT_TEXT),
            f7: fileResult("cover-letter.pdf", "A cover letter. No accounts."),
          },
        },
      ),
    ).rejects.toThrow(/no rows in this import came from file "cover-letter\.pdf"/i);
    expect(vi.mocked(downloadImportFile)).not.toHaveBeenCalled();
  });

  // The model's tool-call args are unvalidated JSON, so an omitted name has
  // to read as an instruction rather than as a TypeError from `.trim()`.
  it("reread_document asks for a document name when the model omits one", async () => {
    const message = await rejectionMessage(
      rereadDocument(
        payload(),
        { question: "?" } as never,
        fakeModel,
        { importId: "i1", fileResults: fileResultsWithText(STATEMENT_TEXT) },
      ),
    );
    expect(message).toMatch(/name the source document/i);
  });

  // Ruling 86 does not weaken. A file id planted on a row's `__provenance`
  // by the unvalidated accounts-PATCH route still resolves (it is live on a
  // row), but the DB lookup is scoped to THIS import, so it finds nothing.
  // Mutation this catches: dropping the `importId` condition — the lookup
  // would then return another import's file and re-extract it.
  it("reread_document still refuses a file that belongs to a different import", async () => {
    fileRow = undefined; // the importId-scoped query matches nothing
    await expect(
      rereadDocument(
        payload(),
        { fileName: "f1", question: "?" },
        fakeModel,
        { importId: "i1", fileResults: {} },
      ),
    ).rejects.toThrow(/could not be found in this import/i);
    expect(vi.mocked(downloadImportFile)).not.toHaveBeenCalled();
  });
});
