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
    const next = editRow(payload(), { rowId: "r1", field: "basis", value: 10_010.17 });
    expect(next.payload.accounts![0].basis).toBe(10_010.17);
    expect(next.payload.accounts![0].value).toBe(10_000);
    expect(next.payload.accounts![1]).toEqual(payload().accounts![1]);
  });

  // Mutation this catches: dropping the `findRowIndex` throw (e.g.
  // `?? -1` silently falling through to writing index -1).
  it("edit_row rejects a rowId that is not in the payload", () => {
    expect(() => editRow(payload(), { rowId: "nope", field: "value", value: 1 }))
      .toThrow(/unknown row/i);
  });

  // Mutation this catches: Ruling 50's allowlist regressing to a denylist —
  // this specific field (`__rowId`) is never named as "banned" anywhere, so
  // a denylist that only excludes a hardcoded few (e.g. `__provenance`,
  // `match`) would let this write through instead of rejecting it.
  it("edit_row rejects a field that is not an editable column", () => {
    expect(() => editRow(payload(), { rowId: "r1", field: "__rowId", value: "x" }))
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
      expect(() => editRow(payload(), { rowId: "r1", field, value: validValues[field] })).not.toThrow();
    }
  });

  // Review round 1, Important 5 — THE test that matters: a money field must
  // reject a non-numeric value. Mutation this catches: `isValidFieldValue`
  // regressing to "any scalar" (the ORIGINAL, review-flagged behavior) —
  // this is the exact case (`basis: "x"`) the review called out as silently
  // accepted.
  it("edit_row rejects a non-numeric value for a money field", () => {
    expect(() => editRow(payload(), { rowId: "r1", field: "basis", value: "x" }))
      .toThrow(/must be a finite number/i);
    expect(() => editRow(payload(), { rowId: "r1", field: "value", value: "12000" }))
      .toThrow(/must be a finite number/i);
  });

  it("edit_row rejects a non-finite number for a money field", () => {
    expect(() => editRow(payload(), { rowId: "r1", field: "basis", value: Infinity }))
      .toThrow(/must be a finite number/i);
    expect(() => editRow(payload(), { rowId: "r1", field: "basis", value: NaN }))
      .toThrow(/must be a finite number/i);
  });

  it("edit_row rejects an owner value outside client/spouse/joint", () => {
    expect(() => editRow(payload(), { rowId: "r1", field: "owner", value: "trust" }))
      .toThrow(/must be one of/i);
  });

  it("edit_row rejects a category value outside the real enum", () => {
    expect(() => editRow(payload(), { rowId: "r1", field: "category", value: "crypto" }))
      .toThrow(/must be one of/i);
  });

  it("edit_row rejects a subType value outside the real enum", () => {
    expect(() => editRow(payload(), { rowId: "r1", field: "subType", value: "not_a_real_subtype" }))
      .toThrow(/must be one of/i);
  });

  // Mutation this catches: `unionAccountFields` backfilling from `keep` into
  // `merge` instead of the other way — `custodian` would then be dropped
  // instead of surviving, since only r2 (the retired row) carries it.
  it("merge_rows unions two rows and retires the second id", () => {
    const next = mergeRows(payload(), { keepRowId: "r1", mergeRowId: "r2" });
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
    const next = mergeRows(payload(), { keepRowId: "r1", mergeRowId: "r2" });
    expect(next.payload.accounts![0].value).toBe(10_000);
    expect(next.payload.accounts![0].basis).toBe(5_000);
  });

  it("merge_rows rejects merging a row into itself", () => {
    expect(() => mergeRows(payload(), { keepRowId: "r1", mergeRowId: "r1" }))
      .toThrow(/itself/i);
  });

  // Review round 1, Important 4 — THE test that matters: merge is the one
  // irreversible tool. Mutation this catches: dropping `excludedRows` from
  // `mergeRows`'s return (reverting to the reviewed behavior) — the retired
  // row's conflicting fields would then simply be gone with no record.
  it("merge_rows records the retired row in excludedRows, the same as drop_row", () => {
    const next = mergeRows(payload(), { keepRowId: "r1", mergeRowId: "r2" });
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
    const next = mergeRows(payload(), { keepRowId: "r1", mergeRowId: "r2" });
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
    const next = mergeRows(withMatch, { keepRowId: "r1", mergeRowId: "r2" });
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
    const next = mergeRows(withProvenance, { keepRowId: "r1", mergeRowId: "r2" });
    expect(next.payload.accounts![0].__provenance).toEqual({ sourceFileId: "f9", section: "accounts" });
  });

  // Mutation this catches: the FOURTH excluded shape (C3) regressing to a
  // flat `{ __rowId, __excludedReason }` — `.row` / `.reason` would then be
  // `undefined` instead of matching.
  it("drop_row moves the row to excludedRows with its reason, never deleting it", () => {
    const next = dropRow(payload(), { rowId: "r2", reason: "duplicate of r1" });
    expect(next.payload.accounts!.map((r) => r.__rowId)).toEqual(["r1"]);
    expect(next.excludedRows?.[0].row).toMatchObject({ __rowId: "r2" });
    expect(next.excludedRows?.[0].reason).toBe("duplicate of r1");
  });

  it("drop_row rejects an empty reason", () => {
    expect(() => dropRow(payload(), { rowId: "r2", reason: "   " })).toThrow(/reason/i);
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

  /** A fresh `ExtractionResult` fixture carrying real stored text — the
   *  common path after the Critical fix, no DB/blob/extractDocument call
   *  needed. */
  function fileResultsWithText(text: string): Record<string, ExtractionResult> {
    return {
      f1: {
        documentType: "account_statement",
        fileName: "f1.pdf",
        extracted: {
          accounts: [], incomes: [], expenses: [], liabilities: [], entities: [],
          lifePolicies: [], wills: [], savings: [], goals: [],
        },
        warnings: [],
        promptVersion: "v",
        text,
      } as unknown as ExtractionResult,
    };
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
      { fileId: "f1", question: "what is the Roth basis?" },
      documentGroundedModel(),
      { importId: "i1", fileResults: fileResultsWithText(STATEMENT_TEXT) },
    );
    // 12,345.67 comes ONLY from the statement text, never from the row
    // (whose starting basis is 5,000) — proves the text actually reached
    // the model rather than the model guessing from row data.
    expect(result.proposal).toMatchObject({ rowId: "r1", field: "basis", value: 12_345.67 });
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

    const result = await rereadDocument(
      payload(),
      { fileId: "f1", question: "what is the Roth basis?" },
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
    expect(result.proposal).toMatchObject({ rowId: "r1", field: "basis", value: 12_345.67 });
  });

  // Important 2 — THE test that matters: the reviewer disproved the "closed
  // by construction" claim by reading the accounts-PATCH route, which
  // accepts arbitrary `payloadJson.accounts` with no row validation — a
  // foreign file id can be planted onto a row's `__provenance`. Mutation
  // this catches: dropping `eq(clientImportFiles.importId, ...)` from the
  // lookup — this asserts that condition was actually built, not merely
  // that SOME query ran.
  it("scopes the file lookup by BOTH id and importId, not id alone (Important 2)", async () => {
    extractDocument.mockResolvedValue({
      documentType: "account_statement", fileName: "f1.pdf",
      extracted: { accounts: [], incomes: [], expenses: [], liabilities: [], entities: [], lifePolicies: [], wills: [], savings: [], goals: [] },
      warnings: [], promptVersion: "v", text: STATEMENT_TEXT,
    });
    await rereadDocument(
      payload(),
      { fileId: "f1", question: "what is the Roth basis?" },
      fakeModel,
      { importId: "import-abc", fileResults: {} }, // forces the DB-lookup fallback path
    );
    expect(eqCalls).toContainEqual([clientImportFiles.id, "f1"]);
    expect(eqCalls).toContainEqual([clientImportFiles.importId, "import-abc"]);
  });

  // Mutation this catches: `reread_document` writing straight to `payload`
  // instead of returning a `proposal` — the `toEqual(payload())` comparison
  // against a FRESH fixture call (C10) would then fail because the returned
  // payload's `basis` would already be 10010.17.
  it("reread_document proposes a correction rather than applying one", async () => {
    const result = await rereadDocument(
      payload(),
      { fileId: "f1", question: "what is the Roth basis?" },
      fakeModel,
      { importId: "i1", fileResults: fileResultsWithText(STATEMENT_TEXT) },
    );
    expect(result.proposal).toMatchObject({ rowId: "r1", field: "basis", value: 10_010.17 });
    // The payload is untouched until the advisor accepts — compared against
    // a FRESH payload(), not a mutated reference (C10).
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
        { fileId: "f1", question: "?" },
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
        { fileId: "f1", question: "?" },
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
        { fileId: "f1", question: "?" },
        badValueModel,
        { importId: "i1", fileResults: fileResultsWithText(STATEMENT_TEXT) },
      ),
    ).rejects.toThrow(/domain/i);
  });

  // Mutation this catches: dropping the "fileId must already be referenced
  // in this payload" guard — without it, any fileId (including one from a
  // different client/firm) would reach the DB lookup.
  it("reread_document rejects a fileId not referenced by any row in this payload", async () => {
    await expect(
      rereadDocument(
        payload(),
        { fileId: "someone-elses-file", question: "?" },
        fakeModel,
        { importId: "i1", fileResults: {} },
      ),
    ).rejects.toThrow(/no rows/i);
    expect(vi.mocked(downloadImportFile)).not.toHaveBeenCalled();
  });
});
