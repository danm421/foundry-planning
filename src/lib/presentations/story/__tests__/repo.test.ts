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
  listStoryChapters,
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

describe("upsertGeneratedChapter", () => {
  const upsertArgs = async (over: Partial<GeneratedChapter> = {}) => {
    await upsertGeneratedChapter({
      clientId: "client-1", scenarioId: "base", documentRole: "standalone", chapter: chapter(over),
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

  it("conflicts on the client/scenario/role/chapter key", async () => {
    const { target } = await reviewArgs();
    expect(target.map((c) => c.name)).toEqual(KEY);
  });
});
