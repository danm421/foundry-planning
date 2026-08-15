import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { GeneratedChapter } from "../generate";

// Only `@/db` is mocked — the schema and drizzle-orm are real, so every
// assertion below reads the actual SQL object the repository builds (the
// pattern compliance-export/__tests__/drain.test.ts already uses).
const m = vi.hoisted(() => ({
  select: vi.fn(),
  upsert: vi.fn(),
  // Nothing here issues a bare UPDATE. The stub exists so that a regression to
  // one fails as an assertion naming what went wrong, rather than as a
  // TypeError from a missing mock.
  update: vi.fn(),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: (w: unknown) => m.select(w) }) }),
    insert: () => ({
      values: (v: unknown) => ({ onConflictDoUpdate: (c: unknown) => m.upsert(v, c) }),
    }),
    update: () => ({ set: (v: unknown) => ({ where: (w: unknown) => m.update(v, w) }) }),
  },
}));

import {
  resolveChapterText,
  isChapterStale,
  hasNewerGeneration,
  listStoryChapters,
  loadStoryChapter,
  upsertGeneratedChapter,
  updateChapterText,
  markChapterReviewed,
} from "../repo";

const dialect = new PgDialect();
const render = (fragment: unknown) => dialect.sqlToQuery(fragment as never);

const FALLBACK = "The deterministic version.";

const chapter = (over: Partial<GeneratedChapter> = {}): GeneratedChapter => ({
  chapterId: "planInOnePage",
  markdown: "Your plan holds.",
  sourceHash: "hash-1",
  aiSuppressed: false,
  failures: [],
  error: null,
  generatedAt: "2026-08-12T00:00:00.000Z",
  cached: false,
  ...over,
});

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  m.select.mockResolvedValue([]);
  m.upsert.mockResolvedValue(undefined);
  m.update.mockResolvedValue(undefined);
});

/**
 * What the repository actually handed drizzle for the write under test — and
 * proof that the write is an upsert. A bare UPDATE cannot create the row, so it
 * discards the advisor's writing whenever the chapter has none yet.
 */
const lastUpsert = () => {
  expect(m.update).not.toHaveBeenCalled();
  expect(m.upsert).toHaveBeenCalledTimes(1);
  const [values, config] = m.upsert.mock.calls[0] as [
    Record<string, unknown>,
    { target: { name: string }[]; set: Record<string, unknown> },
  ];
  return { values, target: config.target, set: config.set };
};

/**
 * The unique index, as the three writers must name it. `document_role` is part
 * of the KEY rather than a payload column: the Executive brief and the Full
 * story are two presets over one report, and without the role here a deck
 * holding both resolves the same rows twice — so editing the brief's copy edits
 * the full story's, with no advisor workaround.
 */
const KEY = ["client_id", "scenario_id", "document_role", "chapter_id"];

describe("resolveChapterText", () => {
  it("prefers the advisor's edit over the generated text", () => {
    expect(resolveChapterText({ editedText: "Mine.", generatedText: "Model's." }, FALLBACK)).toBe("Mine.");
  });

  it("uses the generated text when there is no edit", () => {
    expect(resolveChapterText({ editedText: null, generatedText: "Model's." }, FALLBACK)).toBe("Model's.");
  });

  it("falls back when there is neither", () => {
    expect(resolveChapterText({ editedText: null, generatedText: null }, FALLBACK)).toBe(FALLBACK);
  });

  it("treats an empty edit as no edit", () => {
    expect(resolveChapterText({ editedText: "   ", generatedText: "Model's." }, FALLBACK)).toBe("Model's.");
  });
});

describe("isChapterStale", () => {
  it("is stale when the plan moved under a stored chapter", () => {
    expect(isChapterStale({ sourceHash: "aaa" }, "bbb")).toBe(true);
  });

  it("is fresh when the hash still matches", () => {
    expect(isChapterStale({ sourceHash: "aaa" }, "aaa")).toBe(false);
  });

  it("is not stale when nothing has been generated yet", () => {
    expect(isChapterStale({ sourceHash: null }, "aaa")).toBe(false);
  });
});

/**
 * "The model rewrote this chapter after the advisor edited it, and what prints
 * is still the advisor's words."
 *
 * Confirmed live on a real household: after one Regenerate over an edited
 * chapter the new prose is stored and INVISIBLE, which is indistinguishable
 * from the button having failed — its failure message is literally "The words
 * on screen are unchanged".
 */
describe("hasNewerGeneration", () => {
  const EDITED = new Date("2026-08-14T11:00:00Z");
  const LATER = new Date("2026-08-14T12:00:00Z");

  it("is true when the model wrote after the advisor did", () => {
    expect(
      hasNewerGeneration({
        editedText: "mine",
        generatedText: "theirs",
        generatedAt: LATER,
        editedAt: EDITED,
      }),
    ).toBe(true);
  });

  it("is false when the advisor wrote last", () => {
    expect(
      hasNewerGeneration({
        editedText: "mine",
        generatedText: "theirs",
        generatedAt: EDITED,
        editedAt: LATER,
      }),
    ).toBe(false);
  });

  it("is false when there is no edit to be shadowed", () => {
    expect(
      hasNewerGeneration({
        editedText: null,
        generatedText: "theirs",
        generatedAt: LATER,
        editedAt: null,
      }),
    ).toBe(false);
  });

  // A whitespace-only edit is not an edit — the same rule `resolveChapterText`
  // already applies, and two spellings of it is how they come apart.
  it("is false for a whitespace-only edit", () => {
    expect(
      hasNewerGeneration({
        editedText: "   ",
        generatedText: "theirs",
        generatedAt: LATER,
        editedAt: EDITED,
      }),
    ).toBe(false);
  });

  // Nothing to offer, so nothing to announce. The panel renders
  // `newerGeneratedText` as the passage the advisor is being asked to accept,
  // so a TRUE here with no words behind it puts a banner and a button over a
  // blank.
  it("is false when the model has written nothing to swap in", () => {
    expect(
      hasNewerGeneration({
        editedText: "mine",
        generatedText: "   ",
        generatedAt: LATER,
        editedAt: EDITED,
      }),
    ).toBe(false);
  });

  /**
   * ⭐⭐ BACKFILL CASE 1 — and it is DECIDABLE, not a guess.
   *
   * `edited_at` NULL means `updateChapterText` has not run since 0242 deployed,
   * and it is the only writer of `edited_text` anywhere in `src/`. A non-null
   * `generated_at` means a generation HAS run since 0242 deployed. So the edit
   * is before the deploy and the generation is after it: the model demonstrably
   * wrote last, and TRUE is the accurate answer rather than an optimistic one.
   *
   * ⚠️ This is the confirmed-live Cooper chapter. Its `edited_at` is NULL, and
   * refusing to answer here would mean pressing Regenerate after deploy stores
   * new prose and STILL shows no banner — so anyone re-running the live repro
   * concludes the fix did not work.
   */
  it("is true for a pre-migration edit once a generation has run since", () => {
    expect(
      hasNewerGeneration({
        editedText: "the advisor's real, pre-migration words",
        generatedText: "theirs",
        generatedAt: LATER,
        editedAt: null,
      }),
    ).toBe(true);
  });

  /**
   * …and the sub-case that is NOT decidable, which is what keeps the rule above
   * honest rather than merely permissive. Neither side has a timestamp, so both
   * writes predate 0242 and their order is genuinely unknowable — a wrong TRUE
   * here puts "Use the new version instead" in front of an advisor over prose
   * nothing superseded.
   */
  it("is false when neither side has a timestamp to be decided on", () => {
    expect(
      hasNewerGeneration({
        editedText: "the advisor's real, pre-migration words",
        generatedText: "theirs",
        generatedAt: null,
        editedAt: null,
      }),
    ).toBe(false);
  });

  /**
   * ⚠️⚠️ BACKFILL CASE 2, the same argument from the other side: a chapter
   * GENERATED before the column existed carries a null `generated_at`, so
   * "did the model write after the advisor" is equally unanswerable.
   */
  it("is false for a generation made before the column existed", () => {
    expect(
      hasNewerGeneration({
        editedText: "mine",
        generatedText: "theirs",
        generatedAt: null,
        editedAt: EDITED,
      }),
    ).toBe(false);
  });

  /**
   * The save path itself. `updateChapterText` stamps `editedAt` from the same
   * clock read as `updatedAt`, and a generation that produced the identical
   * words does not move `generatedAt` at all — so equal timestamps mean "the
   * advisor's write is the current one", never "the model's is".
   */
  it("is false when the two timestamps are the same instant", () => {
    const at = new Date("2026-08-14T12:00:00Z");
    expect(
      hasNewerGeneration({
        editedText: "mine",
        generatedText: "theirs",
        generatedAt: at,
        editedAt: at,
      }),
    ).toBe(false);
  });
});

describe("listStoryChapters", () => {
  it("reads one client's chapters for one scenario in one role", async () => {
    await listStoryChapters("client-1", "base", "standalone");
    const { sql, params } = render(m.select.mock.calls[0][0]);
    expect(sql).toContain("client_id");
    expect(sql).toContain("scenario_id");
    expect(sql).toContain("document_role");
    expect(params).toEqual(["client-1", "base", "standalone"]);
  });

  // The whole point of the column. Without this filter a deck holding the brief
  // AND the full story reads one set of rows twice and prints it twice.
  it("reads the other role's rows for the other role", async () => {
    await listStoryChapters("client-1", "base", "frontMatter");
    expect(render(m.select.mock.calls[0][0]).params).toEqual(["client-1", "base", "frontMatter"]);
  });
});

/**
 * ONE chapter's row, for the one caller that has to look before it writes:
 * "Use the new version instead" discards advisor prose, so the route checks
 * that the version it is about to discard really is shadowing a newer one.
 */
describe("loadStoryChapter", () => {
  const load = async () => {
    const row = await loadStoryChapter({
      clientId: "client-1",
      scenarioId: "scenario-9",
      documentRole: "frontMatter",
      chapterId: "whatYouHave",
    });
    return { row, where: render(m.select.mock.calls[0][0]) };
  };

  // Scoped on the FULL key, not just the chapter: the same chapter id exists
  // for every client, scenario and register in the table, and a read missing a
  // term would answer the accept guard about somebody else's row.
  it("reads the one row the four-part key names", async () => {
    const { where } = await load();
    expect(where.sql).toContain("client_id");
    expect(where.sql).toContain("scenario_id");
    expect(where.sql).toContain("document_role");
    expect(where.sql).toContain("chapter_id");
    expect(where.params).toEqual(["client-1", "scenario-9", "frontMatter", "whatYouHave"]);
  });

  // The panel offers every chapter whether one has been generated or not, so
  // "no row" is an ordinary state and has to be an ordinary answer — not an
  // index error on an empty array.
  it("answers null for a chapter that has no row", async () => {
    m.select.mockResolvedValue([]);
    expect((await load()).row).toBeNull();
  });

  it("returns the row when there is one", async () => {
    m.select.mockResolvedValue([{ chapterId: "whatYouHave", generatedText: "Words." }]);
    expect((await load()).row).toMatchObject({ generatedText: "Words." });
  });
});

describe("upsertGeneratedChapter", () => {
  const upsertArgs = async (over: Partial<GeneratedChapter> = {}) => {
    await upsertGeneratedChapter({
      clientId: "client-1",
      scenarioId: "base",
      documentRole: "standalone",
      chapter: chapter(over),
      generatedByUserId: "user_42",
    });
    return lastUpsert();
  };

  it("stores the chapter's words, its hash and its scope", async () => {
    const { values } = await upsertArgs();
    expect(values).toMatchObject({
      clientId: "client-1",
      scenarioId: "base",
      documentRole: "standalone",
      chapterId: "planInOnePage",
      generatedText: "Your plan holds.",
      sourceHash: "hash-1",
      aiSuppressed: false,
    });
  });

  // The insert path above only runs once per chapter. Everything after the
  // first generation goes through the conflict branch, so a column missing
  // there is a column that never changes again: the stored chapter would freeze
  // at the first run's words, and `isChapterStale` would compare every future
  // plan against a hash that can no longer move.
  it("overwrites the stored words, hash and timestamp on a regeneration", async () => {
    const { set } = await upsertArgs({ markdown: "Rewritten.", sourceHash: "hash-2" });
    expect(set.generatedText).toBe("Rewritten.");
    expect(set.sourceHash).toBe("hash-2");
    expect(set.updatedAt).toBeInstanceOf(Date);
  });

  // An outage and a clean run are otherwise identical once stored — both leave
  // `failures` empty — so dropping this column makes "the assistant was down"
  // unrecoverable the moment the row is written.
  it("stores the outage reason alongside the suppression flag", async () => {
    const { values, set } = await upsertArgs({
      aiSuppressed: true,
      error: "The writing assistant was unavailable.",
    });
    expect(values.error).toBe("The writing assistant was unavailable.");
    expect(set.error).toBe("The writing assistant was unavailable.");
    expect(set.aiSuppressed).toBe(true);
  });

  it("clears a stored outage reason when a later run comes back clean", async () => {
    const { set } = await upsertArgs({ error: null });
    expect(set.error).toBeNull();
  });

  it("never overwrites the advisor's edit", async () => {
    const { values, set } = await upsertArgs();
    expect(values).not.toHaveProperty("editedText");
    expect(set).not.toHaveProperty("editedText");
  });

  it("conflicts on the client/scenario/role/chapter key", async () => {
    const { target } = await upsertArgs();
    expect(target.map((c) => c.name)).toEqual(KEY);
  });

  /**
   * ⚠️⚠️ Whose voice these words are in, stamped on the row — and stamped
   * UNCONDITIONALLY, exactly as `sourceHash` beside it is.
   *
   * The freshness check rebuilds the stored hash and compares. The hash is
   * built from a voice, so the row has to say WHOSE, or the check rebuilds it
   * in the reader's voice and a colleague opening a report written in another
   * advisor's personal voice sees an out-of-date badge on all fourteen
   * chapters with nothing able to clear it.
   *
   * Unconditional because it must agree with `sourceHash`, which is: the two
   * are the question and the answer, and a run that reproduces the same words
   * still overwrites the hash with its own.
   */
  it("stamps whose voice wrote the chapter, on both the first run and every later one", async () => {
    const { values, set } = await upsertArgs();
    expect(values.generatedByUserId).toBe("user_42");
    expect(set.generatedByUserId).toBe("user_42");
  });

  /**
   * ⭐ When the model's words last actually CHANGED — the timestamp
   * `hasNewerGeneration` reads, and the reason it is not `updatedAt`.
   *
   * Conditional on the same `TEXT_CHANGED` predicate the review flags are
   * cleared under, and for the mirror-image reason: the generate route upserts
   * on EVERY run including a cache hit that reproduces the stored chapter word
   * for word. An unconditional stamp there would tell an advisor who edited a
   * chapter and then pressed Generate all that "the assistant rewrote this
   * chapter after you edited it" — and offer to replace their writing with the
   * very prose they had already replaced.
   */
  it("records when the words changed, and holds still when a run reproduces them", async () => {
    const { values, set } = await upsertArgs();
    expect(values.generatedAt).toBeInstanceOf(Date);
    const { sql, params } = render(set.generatedAt);
    expect(sql).toContain("is distinct from excluded.generated_text");
    expect(sql).toMatch(/then \$\d+::timestamp else/i);
    expect(sql).toContain('"plan_story_chapters"."generated_at"');
    /**
     * ⚠️⚠️ A UTC ISO STRING, and the SAME instant the insert path stores.
     *
     * The insert goes through drizzle's `timestamp` column, which maps a Date
     * with `toISOString()`. This branch is a raw fragment with no column to map
     * through, so a bound Date would be serialized by node-postgres in LOCAL
     * time with an offset that `timestamp without time zone` then truncates —
     * the same moment stored hours apart depending on which path ran, and
     * `hasNewerGeneration` comparing the two would be reading noise.
     */
    expect(params).toEqual([(values.generatedAt as Date).toISOString()]);
    expect(String(params[0])).toMatch(/Z$/);
  });

  // Review says "an advisor read THESE words and approved them". New words must
  // arrive unreviewed — but a re-render that lands on the same chapter (a cache
  // hit, or a Regenerate that reproduces it) must not un-review it either, or
  // the flag could never survive a page load.
  it("un-reviews the chapter only when the words actually change", async () => {
    const { set } = await upsertArgs();
    for (const column of ["reviewedAt", "reviewedByUserId"]) {
      const { sql } = render(set[column]);
      expect(sql).toContain("is distinct from excluded.generated_text");
      expect(sql).toMatch(/then null else/i);
      expect(sql).toContain('"plan_story_chapters"."generated_text"');
    }
    expect(render(set.reviewedAt).sql).toContain('"plan_story_chapters"."reviewed_at"');
    expect(render(set.reviewedByUserId).sql).toContain('"plan_story_chapters"."reviewed_by_user_id"');
  });
});

describe("updateChapterText", () => {
  const editArgs = async () => {
    await updateChapterText({
      clientId: "client-1",
      scenarioId: "scenario-9",
      documentRole: "frontMatter",
      chapterId: "whatYouHave",
      editedText: "My words.",
    });
    return lastUpsert();
  };

  // The panel offers every chapter, generated or not, so an advisor can write
  // one from scratch. A bare UPDATE matches no row there and reports nothing:
  // the route returns 200, audits the edit, and the writing is gone.
  it("creates the row when the chapter has never been generated", async () => {
    const { values } = await editArgs();
    expect(values).toMatchObject({
      clientId: "client-1",
      scenarioId: "scenario-9",
      documentRole: "frontMatter",
      chapterId: "whatYouHave",
      editedText: "My words.",
    });
  });

  it("stores the advisor's text on an existing row, leaving the model's alone", async () => {
    const { set } = await editArgs();
    expect(set.editedText).toBe("My words.");
    expect(set.updatedAt).toBeInstanceOf(Date);
    expect(set).not.toHaveProperty("generatedText");
  });

  /**
   * ⭐ WHEN the advisor wrote — the other half of `hasNewerGeneration`, and on
   * BOTH paths. The insert path runs whenever a chapter has never been
   * generated, which the panel actively offers; a stamp only in the conflict
   * branch would leave those rows saying the advisor has never written.
   *
   * ⚠️ ONE clock read shared with `updatedAt`, so the two are the same instant
   * rather than a millisecond apart. `hasNewerGeneration` asks whether the
   * model's stamp is strictly later, and two `new Date()` calls here would let
   * an ordinary save read as a rewrite that shadowed it.
   */
  it("records when the advisor wrote, on both the insert and the conflict path", async () => {
    const { values, set } = await editArgs();
    expect(values.editedAt).toBeInstanceOf(Date);
    expect(set.editedAt).toBeInstanceOf(Date);
    expect((set.editedAt as Date).getTime()).toBe((set.updatedAt as Date).getTime());
    expect((values.editedAt as Date).getTime()).toBe((set.editedAt as Date).getTime());
  });

  it("conflicts on the client/scenario/role/chapter key", async () => {
    const { target } = await editArgs();
    expect(target.map((c) => c.name)).toEqual(KEY);
  });
});

describe("markChapterReviewed", () => {
  const reviewArgs = async () => {
    await markChapterReviewed({
      clientId: "client-1",
      scenarioId: "scenario-9",
      documentRole: "frontMatter",
      chapterId: "whatWeRecommend",
      userId: "user_42",
    });
    return lastUpsert();
  };

  // With nothing generated the deterministic narrative is what the client
  // reads, so approving it is legitimate — and if this cannot create a row, that
  // chapter stays in the unreviewed count forever and an export gate reading
  // that count can never be cleared.
  it("creates the row so a never-generated chapter can still be approved", async () => {
    const { values } = await reviewArgs();
    expect(values).toMatchObject({
      clientId: "client-1",
      scenarioId: "scenario-9",
      documentRole: "frontMatter",
      chapterId: "whatWeRecommend",
      reviewedByUserId: "user_42",
    });
    expect(values.reviewedAt).toBeInstanceOf(Date);
  });

  it("records who reviewed it and when", async () => {
    const { set } = await reviewArgs();
    expect(set.reviewedAt).toBeInstanceOf(Date);
    expect(set.reviewedByUserId).toBe("user_42");
  });

  /**
   * ⚠️⚠️ THE REASON `hasNewerGeneration` DOES NOT READ `updatedAt`, pinned as a
   * property of this writer rather than left as an assertion in a comment.
   *
   * Marking a chapter reviewed moves `updatedAt` and leaves `editedAt` alone.
   * So on the ordinary flow — edit a chapter, then mark it reviewed —
   * `updatedAt` ends up strictly later than `editedAt` with no model call
   * anywhere near it. "Is the model's version newer than the advisor's" asked
   * against `updatedAt` answers YES there, which would put "Use the new version
   * instead" in front of every advisor who reviewed their own writing, over
   * prose they had already replaced.
   *
   * `generatedAt` exists because of this line. If a later change makes this
   * writer stop touching `updatedAt`, that does not make `updatedAt` usable —
   * it makes it a timestamp two unrelated writers happen to agree about.
   */
  it("moves the row's updated stamp without claiming the advisor wrote", async () => {
    const { values, set } = await reviewArgs();
    expect(set.updatedAt).toBeInstanceOf(Date);
    expect(set).not.toHaveProperty("editedAt");
    expect(values).not.toHaveProperty("editedAt");
    // …and it does not claim a generation either, for the same reason: the
    // words on the row are whatever they already were.
    expect(set).not.toHaveProperty("generatedAt");
    expect(set).not.toHaveProperty("generatedByUserId");
  });

  it("conflicts on the client/scenario/role/chapter key", async () => {
    const { target } = await reviewArgs();
    expect(target.map((c) => c.name)).toEqual(KEY);
  });
});
