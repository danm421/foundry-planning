// `unreviewedStoryChapters` reads storage ONLY — no projection, no model call
// — so `listStoryChapters` is the one seam worth mocking. Everything else
// (`planStoryOptionsSchema`, `printedChapters`) stays real: the whole point of
// this gate is that it counts against the SAME print list the renderer uses,
// and a mock of that list would make the "counts only what prints" tests true
// by construction instead of by measurement.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PlanStoryChapterRow } from "@/db/schema";
import { GATE_VERSION } from "../validate";
import { PRESETS } from "@/lib/presentations/pages/plan-story/options-schema";
import type { PresentationPageDescriptor } from "@/lib/presentations/types";

const m = vi.hoisted(() => ({ listStoryChapters: vi.fn() }));

vi.mock("@/lib/presentations/story/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../repo")>()),
  listStoryChapters: m.listStoryChapters,
}));

import { unreviewedStoryChapters, InvalidStoryOptionsError } from "../export-gate";

const CLIENT = "c1a11111-2222-4333-8444-555555555555";

const row = (over: Partial<PlanStoryChapterRow> & { chapterId: string }): PlanStoryChapterRow => ({
  id: "row-1",
  clientId: CLIENT,
  scenarioId: "base",
  documentRole: "standalone",
  generatedText: null,
  generatedAt: null,
  generatedByUserId: null,
  editedText: null,
  editedAt: null,
  sourceHash: null,
  gateVersion: GATE_VERSION,
  aiSuppressed: false,
  error: null,
  reviewedAt: null,
  reviewedByUserId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

// A scenario is set (so all fourteen chapters are eligible — neither of the
// two `requiresProposal` chapters is dropped) and two of the fourteen `sections`
// are switched off — twelve print. Measured, not assumed: a base-only story
// (no scenario) prints TWELVE, never fourteen — see `STORY_PAGE_ALL_ON` below.
const STORY_PAGE_WITH_TWELVE_SECTIONS = {
  pageId: "planStory",
  options: {
    scenarioId: "scenario-growth",
    sections: { thingsToKnow: false, healthCareCosts: false },
  },
};

// Four of the twelve printed chapters reviewed, PLUS a fifth row that
// EXISTS but was never reviewed (`reviewedAt: null`, the `row()` default) —
// the most common real state: the model generated the chapter, a row is
// there, nobody has read it. Without the `reviewedAt != null` filter in
// `export-gate.ts`, this row's mere presence would count it reviewed too,
// understating the gate — 12 - 5 = 7, not 8. 12 - 4 = 8 — NOT 14 - 4 = 10
// either, which is what counting against every chapter that EXISTS, rather
// than every chapter this page PRINTS, would answer instead.
const REVIEWED_FOUR = [
  row({ chapterId: "planInOnePage", reviewedAt: new Date("2026-01-01") }),
  row({ chapterId: "whatWerePlanningFor", reviewedAt: new Date("2026-01-01") }),
  row({ chapterId: "whatYouHave", reviewedAt: new Date("2026-01-01") }),
  row({ chapterId: "whereTheMoneyGoes", reviewedAt: new Date("2026-01-01") }),
  row({ chapterId: "thePathYoureOn" }), // generated, present, never reviewed
];

// Every default option, untouched. Base-only (no scenario), so the two
// `requiresProposal` chapters don't print — measured at TWELVE, not fourteen.
const STORY_PAGE_ALL_ON = {
  pageId: "planStory",
  options: {},
};

// Two Plan Story pages in one deck, same scenario, different registers — the
// brief up front (`frontMatter`, three chapters offered) and the standalone
// report (`standalone`, all fourteen since a scenario is set).
const BRIEF_PAGE = {
  pageId: "planStory",
  options: { ...PRESETS.brief, scenarioId: "scenario-growth" },
};
const FULL_PAGE = {
  pageId: "planStory",
  options: { ...PRESETS.full, scenarioId: "scenario-growth" },
};

beforeEach(() => {
  m.listStoryChapters.mockReset();
  m.listStoryChapters.mockResolvedValue([]);
});

describe("unreviewedStoryChapters", () => {
  it("answers an empty array for a deck with no story page, WITHOUT touching the database", async () => {
    await expect(
      unreviewedStoryChapters(CLIENT, [{ pageId: "balanceSheet", options: {} }]),
    ).resolves.toEqual([]);
    expect(m.listStoryChapters).not.toHaveBeenCalled();
  });

  it("counts only the chapters this page PRINTS", async () => {
    m.listStoryChapters.mockResolvedValueOnce(REVIEWED_FOUR);
    const [page] = await unreviewedStoryChapters(CLIENT, [STORY_PAGE_WITH_TWELVE_SECTIONS]);
    expect(page).toMatchObject({ unreviewed: 8, total: 12 });
    expect(m.listStoryChapters).toHaveBeenCalledWith(CLIENT, "scenario-growth", "standalone");
  });

  it("counts a chapter with no row at all as unreviewed", async () => {
    m.listStoryChapters.mockResolvedValueOnce([]);
    const [page] = await unreviewedStoryChapters(CLIENT, [STORY_PAGE_ALL_ON]);
    expect(page.unreviewed).toBe(page.total);
    // Pinned to the measured base-only count, not "every chapter that exists" —
    // an implementation that fell back to CHAPTER_IDS.length would read 14 here.
    expect(page.total).toBe(12);
  });

  it("counts each document role separately, so a brief and a full story do not share a count", async () => {
    const out = await unreviewedStoryChapters(CLIENT, [BRIEF_PAGE, FULL_PAGE]);
    expect(out).toHaveLength(2);
    expect(out[0].documentRole).toBe("frontMatter");
    expect(out[1].documentRole).toBe("standalone");
    // Two separate reads, one per register — never one query answering both.
    expect(m.listStoryChapters).toHaveBeenCalledWith(CLIENT, "scenario-growth", "frontMatter");
    expect(m.listStoryChapters).toHaveBeenCalledWith(CLIENT, "scenario-growth", "standalone");
    expect(m.listStoryChapters).toHaveBeenCalledTimes(2);
  });

  it("defaults the options for a page with none stored, rather than throwing", async () => {
    // `options` is required on `PresentationPageDescriptor` (every real
    // caller's `BodySchema` guarantees it), but the gate's own `?? {}`
    // fallback is what stands between a malformed payload and an uncaught
    // ZodError — worth pinning even though the type says this can't happen.
    const noOptions = { pageId: "planStory" } as unknown as PresentationPageDescriptor;
    const [page] = await unreviewedStoryChapters(CLIENT, [noOptions]);
    expect(page.scenarioId).toBe("base");
    expect(page.documentRole).toBe("standalone");
  });

  // Finding 10: caller-supplied `page.options` is unvalidated by `BodySchema`
  // (`runs/route.ts`), so a malformed blob used to reach `planStoryOptionsSchema
  // .parse` here and throw an uncaught ZodError — a 500 for what is a 400-shaped
  // client mistake. The gate now throws a typed error instead, so the route can
  // tell the two apart.
  it("throws InvalidStoryOptionsError, not a raw ZodError, for options that fail the schema", async () => {
    const malformed = {
      pageId: "planStory",
      options: { documentRole: "not-a-real-role" },
    } as unknown as PresentationPageDescriptor;
    await expect(unreviewedStoryChapters(CLIENT, [malformed])).rejects.toBeInstanceOf(
      InvalidStoryOptionsError,
    );
    expect(m.listStoryChapters).not.toHaveBeenCalled();
  });
});
