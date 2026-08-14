import { describe, it, expect, vi, beforeEach } from "vitest";
import { Column, Param, SQL, StringChunk, getTableColumns } from "drizzle-orm";
import { storyVoiceProfiles, storyVoiceSamples } from "@/db/schema";

// Only `@/db` is mocked — the schema and drizzle-orm are real, so the `where`
// clause each function builds is the actual SQL condition object drizzle
// would receive (the pattern `story/__tests__/repo.test.ts` already uses).
//
// That file's harness stops at capturing the condition for SQL-text
// assertions; it never applies it to data, because none of its functions
// need to prove a `where` clause actually excludes rows. This module's do —
// `loadVoiceProfile` and friends exist specifically to keep one firm's rows
// out of another firm's hands — so the harness below goes one step further:
// `rows` is the state of BOTH tables (row shape alone tells them apart), and
// `matches` walks the real drizzle condition against each row instead of
// returning `rows` verbatim. A `where` that dropped its firmId comparison,
// or a mock that ignored `where` entirely, would fail the scoping tests.

/**
 * Postgres column name -> the row's JS key, merged across both voice tables.
 * Both share `id`/`firm_id`/`advisor_user_id`, so one map covers either.
 */
const COLUMN_KEY: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(getTableColumns(storyVoiceProfiles)).map(([key, col]) => [col.name, key]),
  ),
  ...Object.fromEntries(
    Object.entries(getTableColumns(storyVoiceSamples)).map(([key, col]) => [col.name, key]),
  ),
};

/**
 * Evaluates a drizzle `eq(...)` / `and(eq(...), eq(...))` condition against a
 * plain row object by walking its query chunks. Real filtering, not a stub —
 * this is what makes the cross-firm scoping tests meaningful.
 */
function matches(condition: SQL, row: Record<string, unknown>): boolean {
  const chunks = condition.queryChunks;
  const column = chunks.find((c): c is Column => c instanceof Column);
  const param = chunks.find((c): c is Param => c instanceof Param);
  const nested = chunks.filter((c): c is SQL => c instanceof SQL);
  if (column && param && nested.length === 0) {
    return row[COLUMN_KEY[column.name]] === param.value;
  }
  const isOr = chunks.some((c) => c instanceof StringChunk && c.value.join("").trim() === "or");
  const results = nested.map((n) => matches(n, row));
  return isOr ? results.some(Boolean) : results.every(Boolean);
}

const m = vi.hoisted(() => ({
  upsert: vi.fn(),
  insertReturning: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

/** All rows across both tables, mutated per-test. Row shape (which columns
 *  are present) is enough to tell a profile row from a sample row — the mock
 *  never needs to know which table a call targets, only how to filter. */
let rows: Record<string, unknown>[] = [];

const selectResult = (filtered: Record<string, unknown>[]) => ({
  orderBy: () => Promise.resolve(filtered),
  then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(filtered).then(resolve, reject),
});

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (w: SQL) => selectResult(rows.filter((r) => matches(w, r))),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoUpdate: (c: unknown) => {
          m.upsert(v, c);
          return Promise.resolve(undefined);
        },
        returning: () => {
          m.insertReturning(v);
          return Promise.resolve([{ id: "generated-id" }]);
        },
      }),
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: (w: SQL) => {
          const matched = rows.filter((r) => matches(w, r));
          m.update(v, w);
          return { returning: () => Promise.resolve(matched.map((r) => ({ id: r.id }))) };
        },
      }),
    }),
    delete: () => ({
      where: (w: SQL) => {
        const matched = rows.filter((r) => matches(w, r));
        m.delete(w);
        return { returning: () => Promise.resolve(matched.map((r) => ({ id: r.id }))) };
      },
    }),
  },
}));

import {
  loadVoiceProfile,
  upsertVoiceProfile,
  listVoiceSamples,
  insertVoiceSample,
  setVoiceSampleEnabled,
  deleteVoiceSample,
  FIRM_DEFAULT_ADVISOR,
} from "../repo";

const FIRM = "firm-1";
const USER = "user-1";
const SAMPLE = "sample-1";

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  rows = [];
});

describe("FIRM_DEFAULT_ADVISOR", () => {
  it("is the empty string, not null or a sentinel word", () => {
    expect(FIRM_DEFAULT_ADVISOR).toBe("");
  });
});

describe("loadVoiceProfile", () => {
  it("prefers the advisor's own row over the firm default", async () => {
    rows = [
      { firmId: FIRM, advisorUserId: "", styleNote: "firm voice" },
      { firmId: FIRM, advisorUserId: USER, styleNote: "my voice" },
    ];
    await expect(loadVoiceProfile(FIRM, USER)).resolves.toMatchObject({ styleNote: "my voice" });
  });

  it("falls back to the firm default when the advisor has no row", async () => {
    rows = [{ firmId: FIRM, advisorUserId: "", styleNote: "firm voice" }];
    await expect(loadVoiceProfile(FIRM, USER)).resolves.toMatchObject({ styleNote: "firm voice" });
  });

  it("answers null when neither exists, rather than an empty profile", async () => {
    rows = [];
    await expect(loadVoiceProfile(FIRM, USER)).resolves.toBeNull();
  });

  // The scoping proof. Every statement in this module is firm-scoped, and a
  // test that only ever sees one firm cannot tell.
  it("never returns another firm's profile", async () => {
    rows = [{ firmId: "firm-other", advisorUserId: USER, styleNote: "theirs" }];
    await expect(loadVoiceProfile(FIRM, USER)).resolves.toBeNull();
  });
});

describe("upsertVoiceProfile", () => {
  it("writes the firm, advisor, style note and author", async () => {
    await upsertVoiceProfile({ firmId: FIRM, advisorUserId: USER, styleNote: "Warm, brief.", updatedBy: "user_9" });
    expect(m.upsert).toHaveBeenCalledTimes(1);
    const [values] = m.upsert.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(values).toMatchObject({
      firmId: FIRM,
      advisorUserId: USER,
      styleNote: "Warm, brief.",
      updatedBy: "user_9",
    });
  });

  it("conflicts on the firm/advisor key, updating the note, author and timestamp", async () => {
    await upsertVoiceProfile({ firmId: FIRM, advisorUserId: USER, styleNote: "Warm.", updatedBy: "user_9" });
    const [, config] = m.upsert.mock.calls[0] as [
      unknown,
      { target: { name: string }[]; set: Record<string, unknown> },
    ];
    expect(config.target.map((c) => c.name)).toEqual(["firm_id", "advisor_user_id"]);
    expect(config.set).toMatchObject({ styleNote: "Warm.", updatedBy: "user_9" });
    expect(config.set.updatedAt).toBeInstanceOf(Date);
  });

  it("writes the firm-default row when advisorUserId is empty", async () => {
    await upsertVoiceProfile({ firmId: FIRM, advisorUserId: FIRM_DEFAULT_ADVISOR, styleNote: "House style.", updatedBy: "user_9" });
    const [values] = m.upsert.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(values.advisorUserId).toBe("");
  });
});

describe("listVoiceSamples", () => {
  // The whole point of this function: a firm sample is a house style an
  // advisor adds their own voice on top of, so both must come back — unlike
  // the PROFILE, where the advisor's row shadows the firm's.
  it("returns both the advisor's own samples and the firm's", async () => {
    rows = [
      { id: "s1", firmId: FIRM, advisorUserId: USER, createdAt: new Date(2) },
      { id: "s2", firmId: FIRM, advisorUserId: "", createdAt: new Date(1) },
    ];
    const result = await listVoiceSamples(FIRM, USER);
    expect(result.map((r) => r.id).sort()).toEqual(["s1", "s2"]);
  });

  it("excludes another advisor's samples at the same firm", async () => {
    rows = [
      { id: "s1", firmId: FIRM, advisorUserId: USER, createdAt: new Date(2) },
      { id: "s2", firmId: FIRM, advisorUserId: "someone-else", createdAt: new Date(1) },
    ];
    const result = await listVoiceSamples(FIRM, USER);
    expect(result.map((r) => r.id)).toEqual(["s1"]);
  });

  // The scoping proof for this table.
  it("never returns another firm's samples", async () => {
    rows = [{ id: "s1", firmId: "firm-other", advisorUserId: USER, createdAt: new Date() }];
    await expect(listVoiceSamples(FIRM, USER)).resolves.toEqual([]);
  });
});

describe("insertVoiceSample", () => {
  it("stores the scrubbed text, its source and its author", async () => {
    await insertVoiceSample({
      firmId: FIRM,
      advisorUserId: USER,
      text: "Scrubbed prose.",
      sourceChapterId: "planInOnePage",
      sourceClientId: "client-1",
      createdBy: "user_9",
    });
    expect(m.insertReturning).toHaveBeenCalledTimes(1);
    const [values] = m.insertReturning.mock.calls[0] as [Record<string, unknown>];
    expect(values).toMatchObject({
      firmId: FIRM,
      advisorUserId: USER,
      text: "Scrubbed prose.",
      sourceChapterId: "planInOnePage",
      sourceClientId: "client-1",
      createdBy: "user_9",
    });
  });

  // The rule the schema docblock states: every row starts disabled, no
  // matter what the caller passes.
  it("always inserts with enabled: false, regardless of what the caller passes", async () => {
    await insertVoiceSample({
      firmId: FIRM,
      advisorUserId: USER,
      text: "x",
      sourceChapterId: null,
      sourceClientId: null,
      createdBy: "user_9",
    });
    const [values] = m.insertReturning.mock.calls[0] as [Record<string, unknown>];
    expect(values.enabled).toBe(false);
  });

  it("returns the new row's id", async () => {
    await expect(
      insertVoiceSample({
        firmId: FIRM,
        advisorUserId: USER,
        text: "x",
        sourceChapterId: null,
        sourceClientId: null,
        createdBy: "user_9",
      }),
    ).resolves.toBe("generated-id");
  });
});

describe("setVoiceSampleEnabled", () => {
  it("turns a sample on when it belongs to this firm", async () => {
    rows = [{ id: SAMPLE, firmId: FIRM, enabled: false }];
    await expect(setVoiceSampleEnabled({ firmId: FIRM, id: SAMPLE, enabled: true })).resolves.toBe(true);
  });

  it("reports false when the id belongs to another firm", async () => {
    rows = [{ id: SAMPLE, firmId: "firm-other", enabled: false }];
    await expect(setVoiceSampleEnabled({ firmId: FIRM, id: SAMPLE, enabled: true })).resolves.toBe(false);
  });

  it("reports false when no row has that id at all", async () => {
    rows = [];
    await expect(setVoiceSampleEnabled({ firmId: FIRM, id: SAMPLE, enabled: true })).resolves.toBe(false);
  });
});

describe("deleteVoiceSample", () => {
  it("deletes a sample that belongs to this firm", async () => {
    rows = [{ id: SAMPLE, firmId: FIRM }];
    await expect(deleteVoiceSample({ firmId: FIRM, id: SAMPLE })).resolves.toBe(true);
  });

  // The scoping proof for a mutation: an advisor who guesses another firm's
  // sample id must not be able to delete it.
  it("reports false rather than deleting when the id belongs to another firm", async () => {
    rows = [{ id: SAMPLE, firmId: "firm-other" }];
    await expect(deleteVoiceSample({ firmId: FIRM, id: SAMPLE })).resolves.toBe(false);
  });
});
