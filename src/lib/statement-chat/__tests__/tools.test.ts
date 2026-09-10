import { describe, it, expect, vi, beforeEach } from "vitest";

// `reread_document` is the only tool that does IO (a DB lookup for the
// file's blob URL, then a blob download) — mocked here the same way
// `chat/extract/route.ts`'s gate.test.ts mocks them, so this stays a plain
// unit test with no real Postgres/Blob call.
let fileRow: { blobUrl: string } | undefined = { blobUrl: "https://blob/f1.pdf" };
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
vi.mock("@/lib/imports/blob", () => ({
  downloadImportFile: vi.fn(async () => Buffer.from("statement text")),
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
import type { PersistedImportPayload } from "@/lib/imports/types";
import { downloadImportFile } from "@/lib/imports/blob";

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
  // actually be accepted — a list that's merely non-empty (but missing a
  // real column) would pass the test above without this one.
  it("edit_row accepts every column on the allowlist", () => {
    for (const field of EDITABLE_ACCOUNT_FIELDS) {
      expect(() => editRow(payload(), { rowId: "r1", field, value: "x" })).not.toThrow();
    }
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

  const fakeModel: RereadModel = {
    invoke: async () => ({
      content: JSON.stringify({ rowId: "r1", field: "basis", value: 10_010.17 }),
    }),
  };

  // Mutation this catches: `reread_document` writing straight to `payload`
  // instead of returning a `proposal` — the `toEqual(payload())` comparison
  // against a FRESH fixture call (C10) would then fail because the returned
  // payload's `basis` would already be 10010.17.
  it("reread_document proposes a correction rather than applying one", async () => {
    const result = await rereadDocument(
      payload(),
      { fileId: "f1", question: "what is the Roth basis?" },
      fakeModel,
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
      rereadDocument(payload(), { fileId: "f1", question: "?" }, crossFileModel),
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
      rereadDocument(payload(), { fileId: "f1", question: "?" }, badFieldModel),
    ).rejects.toThrow(/not editable/i);
  });

  // Mutation this catches: dropping the "fileId must already be referenced
  // in this payload" guard — without it, any fileId (including one from a
  // different client/firm) would reach the DB lookup.
  it("reread_document rejects a fileId not referenced by any row in this payload", async () => {
    await expect(
      rereadDocument(payload(), { fileId: "someone-elses-file", question: "?" }, fakeModel),
    ).rejects.toThrow(/no rows/i);
    expect(vi.mocked(downloadImportFile)).not.toHaveBeenCalled();
  });
});
