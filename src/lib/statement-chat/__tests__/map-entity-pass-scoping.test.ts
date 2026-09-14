// src/lib/statement-chat/__tests__/map-entity-pass-scoping.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { Column, Param, SQL, StringChunk, getTableColumns } from "drizzle-orm";
import { clientImports } from "@/db/schema";
import type { CandidateRow } from "@/lib/entity-extraction/types";

// A SECOND test file for the same module, for the reason `existing-rows.ts` got
// its own: the sibling `map-entity-pass.test.ts` mocks `@/db` as
// `{ query: {}, update: vi.fn() }`, which cannot exercise a query at all — so
// `runMapEntityPass`, the only function here that writes, would otherwise ship
// with no assertions on WHAT it writes or WHO it will write it for.
//
// Same posture as `existing-rows.test.ts`: `@/db/schema` and `drizzle-orm` stay
// real, so the conditions below are the actual SQL objects drizzle receives, and
// the harness evaluates them against a fixture row rather than ignoring them. An
// `and(...)` that lost its `orgId` leg would fail these tests, not pass them.

type Row = Record<string, unknown>;

/** Postgres column name -> the JS key it occupies on `clientImports`. */
const COLUMN_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(getTableColumns(clientImports)).map(([key, col]) => [col.name, key]),
);

/** Mutable harness state, reset per test. */
const state: {
  imports: Row[];
  /** Runs at the top of `db.update(...)`, standing in for a concurrent write
   *  landing between this function's read and its write. */
  beforeUpdate?: () => void;
  updateCalled: number;
  lastSet?: Row;
} = { imports: [], updateCalled: 0 };

/** Walks a real `eq(column, value)` / `isNull(column)` / `and(...)` condition
 *  against a row. `isNull` carries no Param, so it is read off the SQL text. */
function matches(condition: SQL, row: Row): boolean {
  const chunks = condition.queryChunks;
  const column = chunks.find((c): c is Column => c instanceof Column);
  const param = chunks.find((c): c is Param => c instanceof Param);
  const nested = chunks.filter((c): c is SQL => c instanceof SQL);
  if (nested.length === 0) {
    if (!column) throw new Error("expected a condition on one column");
    const value = row[COLUMN_KEY[column.name]];
    const text = chunks
      .filter((c): c is StringChunk => c instanceof StringChunk)
      .map((c) => c.value.join(""))
      .join("");
    if (/is null/i.test(text)) return value === null || value === undefined;
    if (!param) throw new Error("expected eq(column, value)");
    return value === param.value;
  }
  return nested.every((n) => matches(n, row));
}

vi.mock("@/db", () => ({
  db: {
    query: {
      clientImports: {
        findFirst: ({ where }: { where: SQL }) =>
          Promise.resolve(state.imports.find((row) => matches(where, row))),
      },
    },
    update: () => {
      state.updateCalled += 1;
      state.beforeUpdate?.();
      return {
        set: (patch: Row) => {
          state.lastSet = patch;
          return {
            where: (condition: SQL) => ({
              returning: () => {
                const hit = state.imports.filter((row) => matches(condition, row));
                for (const row of hit) Object.assign(row, patch);
                return Promise.resolve(hit.map((row) => ({ id: row.id })));
              },
            }),
          };
        },
      };
    },
  },
}));

vi.mock("@/lib/entity-extraction", () => ({ extractMapEntities: vi.fn() }));
vi.mock("../existing-rows", () => ({ loadExistingRows: vi.fn() }));

import { extractMapEntities } from "@/lib/entity-extraction";
import { loadExistingRows } from "../existing-rows";
import { runMapEntityPass } from "../map-entity-pass";
import { NotFoundError } from "@/lib/imports/authz";

function candidate(name: string): CandidateRow {
  return {
    entityId: "disability_policy",
    rowId: `f2:disability_policy:0`,
    values: [
      { key: "name", value: name, snippet: name, confidence: 0.9 },
      { key: "insured", value: "client", snippet: "client", confidence: 0.9 },
      { key: "carrier", value: "Unum", snippet: "Unum", confidence: 0.9 },
    ],
    missingRequired: [],
    rowConfidence: 0.9,
  };
}

const ARGS = {
  importId: "imp1",
  clientId: "c1",
  firmId: "org_A",
  fileId: "f2",
  pages: ["page one"],
};

beforeEach(() => {
  vi.clearAllMocks();
  state.imports = [
    {
      id: "imp1",
      clientId: "c1",
      orgId: "org_A",
      discardedAt: null,
      payloadJson: { fileResults: { f1: "kept" }, chat: { transcript: ["kept"] } },
    },
  ];
  state.beforeUpdate = undefined;
  state.updateCalled = 0;
  state.lastSet = undefined;
  vi.mocked(loadExistingRows).mockResolvedValue([]);
  vi.mocked(extractMapEntities).mockResolvedValue({
    rows: { disability_policy: [candidate("Group LTD")] },
    promptVersion: "map:test",
    warnings: ["a warning from the extractor"],
  });
});

describe("runMapEntityPass persistence", () => {
  it("appends the annotated rows under chat.entityRows without losing siblings", async () => {
    const result = await runMapEntityPass(ARGS);

    const payload = state.imports[0].payloadJson as Record<string, Record<string, unknown>>;
    expect(payload.fileResults).toEqual({ f1: "kept" });
    expect(payload.chat.transcript).toEqual(["kept"]);
    const rows = (payload.chat.entityRows as Record<string, CandidateRow[]>).disability_policy;
    expect(rows).toHaveLength(1);
    expect(rows[0].match).toEqual({ kind: "new" });
    expect(result.warnings).toEqual(["a warning from the extractor"]);
    // The caller's clientId has to reach the loader, or the read it scopes is
    // scoped to the wrong client. Every other link in that chain is pinned.
    expect(loadExistingRows).toHaveBeenCalledWith({
      entity: expect.objectContaining({ id: "disability_policy" }),
      clientId: "c1",
    });
  });

  it("adds to an entity that already has rows from an earlier file", async () => {
    const earlier = { ...candidate("Existing"), rowId: "f1:disability_policy:0" };
    (state.imports[0].payloadJson as Record<string, Record<string, unknown>>).chat.entityRows = {
      disability_policy: [earlier],
    };

    await runMapEntityPass(ARGS);

    const payload = state.imports[0].payloadJson as Record<string, Record<string, unknown>>;
    const rows = (payload.chat.entityRows as Record<string, CandidateRow[]>).disability_policy;
    expect(rows.map((r) => r.rowId)).toEqual(["f1:disability_policy:0", "f2:disability_policy:0"]);
  });
});

/**
 * Seed the import with rows an earlier file already stored.
 *
 * A refusal test that starts EMPTY cannot tell a refused write from a write that
 * mutated the snapshot in place and then failed — both leave `chat.entityRows`
 * absent. Starting non-empty makes the assertion discriminating: the stored rows
 * must still be exactly the one that was there.
 */
function seedExistingEntityRows() {
  const chat = (state.imports[0].payloadJson as Record<string, Record<string, unknown>>).chat;
  chat.entityRows = { disability_policy: [{ ...candidate("Existing"), rowId: "f1:disability_policy:0" }] };
}

function expectSnapshotUntouched() {
  const chat = (state.imports[0].payloadJson as Record<string, Record<string, unknown>>).chat;
  const rows = (chat.entityRows as Record<string, CandidateRow[]>).disability_policy;
  expect(rows.map((r) => r.rowId)).toEqual(["f1:disability_policy:0"]);
}

describe("runMapEntityPass surfaces a failed existing-rows read", () => {
  it("warns the caller instead of silently offering every row as new", async () => {
    // `loadExistingRows` fails CLOSED, which is right — but `annotateMatches`
    // catches it and every row then reports `new`, which is exactly what a LEAK
    // would have looked like. The advisor has to be told the difference.
    vi.mocked(loadExistingRows).mockRejectedValue(new Error("no scopePath"));

    const result = await runMapEntityPass(ARGS);

    const payload = state.imports[0].payloadJson as Record<string, Record<string, unknown>>;
    const rows = (payload.chat.entityRows as Record<string, CandidateRow[]>).disability_policy;
    expect(rows[0].match).toEqual({ kind: "new" });
    expect(result.warnings).toEqual([
      "a warning from the extractor",
      expect.stringContaining("no scopePath"),
    ]);
    expect(result.warnings[1]).toMatch(/offered as new/);
  });

  it("says nothing when the read succeeds", async () => {
    const result = await runMapEntityPass(ARGS);
    expect(result.warnings).toEqual(["a warning from the extractor"]);
  });
});

describe("runMapEntityPass is scoped to the client and the firm", () => {
  it("refuses an import id belonging to another firm, and writes nothing", async () => {
    state.imports[0].orgId = "org_B";

    await expect(runMapEntityPass(ARGS)).rejects.toBeInstanceOf(NotFoundError);
    expect(state.updateCalled).toBe(0);
  });

  it("refuses an import id belonging to another client, and writes nothing", async () => {
    state.imports[0].clientId = "OTHER-CLIENT";

    await expect(runMapEntityPass(ARGS)).rejects.toBeInstanceOf(NotFoundError);
    expect(state.updateCalled).toBe(0);
  });

  it("refuses a discarded import, and writes nothing", async () => {
    state.imports[0].discardedAt = new Date("2026-09-14");

    await expect(runMapEntityPass(ARGS)).rejects.toBeInstanceOf(NotFoundError);
    expect(state.updateCalled).toBe(0);
  });

  it("refuses when the firm changes under it between the read and the write", async () => {
    // The update must carry the same firm constraint as the read; an import id
    // on its own is not a tenant boundary. A zero-row update is a refusal.
    seedExistingEntityRows();
    state.beforeUpdate = () => {
      state.imports[0].orgId = "org_B";
    };

    await expect(runMapEntityPass(ARGS)).rejects.toBeInstanceOf(NotFoundError);
    expectSnapshotUntouched();
  });

  it("refuses when the client changes under it between the read and the write", async () => {
    seedExistingEntityRows();
    state.beforeUpdate = () => {
      state.imports[0].clientId = "OTHER-CLIENT";
    };

    await expect(runMapEntityPass(ARGS)).rejects.toBeInstanceOf(NotFoundError);
    expectSnapshotUntouched();
  });
});
