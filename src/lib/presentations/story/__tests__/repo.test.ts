import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { GeneratedChapter } from "../generate";

// Only `@/db` is mocked — the schema and drizzle-orm are real, so every
// assertion below reads the actual SQL object the repository builds (the
// pattern compliance-export/__tests__/drain.test.ts already uses).
const m = vi.hoisted(() => ({
  select: vi.fn(),
  upsert: vi.fn(),
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
  it("reads one client's chapters for one scenario", async () => {
    await listStoryChapters("client-1", "base");
    const { sql, params } = render(m.select.mock.calls[0][0]);
    expect(sql).toContain("client_id");
    expect(sql).toContain("scenario_id");
    expect(params).toEqual(["client-1", "base"]);
  });
});

describe("upsertGeneratedChapter", () => {
  const upsertArgs = async (over: Partial<GeneratedChapter> = {}) => {
    await upsertGeneratedChapter({ clientId: "client-1", scenarioId: "base", chapter: chapter(over) });
    const [values, config] = m.upsert.mock.calls[0] as [
      Record<string, unknown>,
      { target: { name: string }[]; set: Record<string, unknown> },
    ];
    return { values, target: config.target, set: config.set };
  };

  it("stores the chapter's words, its hash and its scope", async () => {
    const { values } = await upsertArgs();
    expect(values).toMatchObject({
      clientId: "client-1",
      scenarioId: "base",
      chapterId: "planInOnePage",
      generatedText: "Your plan holds.",
      sourceHash: "hash-1",
      aiSuppressed: false,
    });
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

  it("conflicts on the client/scenario/chapter triple", async () => {
    const { target } = await upsertArgs();
    expect(target.map((c) => c.name)).toEqual(["client_id", "scenario_id", "chapter_id"]);
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
      chapterId: "whatYouHave",
      editedText: "My words.",
    });
    const [set, where] = m.update.mock.calls[0] as [Record<string, unknown>, unknown];
    return { set, where };
  };

  it("stores the advisor's text and stamps the row", async () => {
    const { set } = await editArgs();
    expect(set.editedText).toBe("My words.");
    expect(set.updatedAt).toBeInstanceOf(Date);
  });

  it("scopes the write to the client, scenario and chapter", async () => {
    const { where } = await editArgs();
    const { sql, params } = render(where);
    expect(sql).toContain("client_id");
    expect(params).toEqual(["client-1", "scenario-9", "whatYouHave"]);
  });
});

describe("markChapterReviewed", () => {
  const reviewArgs = async () => {
    await markChapterReviewed({
      clientId: "client-1",
      scenarioId: "scenario-9",
      chapterId: "whatWeRecommend",
      userId: "user_42",
    });
    const [set, where] = m.update.mock.calls[0] as [Record<string, unknown>, unknown];
    return { set, where };
  };

  it("records who reviewed it and when", async () => {
    const { set } = await reviewArgs();
    expect(set.reviewedAt).toBeInstanceOf(Date);
    expect(set.reviewedByUserId).toBe("user_42");
  });

  it("scopes the write to the client, scenario and chapter", async () => {
    const { where } = await reviewArgs();
    const { sql, params } = render(where);
    expect(sql).toContain("client_id");
    expect(params).toEqual(["client-1", "scenario-9", "whatWeRecommend"]);
  });
});
