// The export loader's one unchecked boundary: `chapter_id` is free text in
// storage, so a row outlives the chapter it names. Plan 2 renames and reorders
// the union, which is exactly the condition that makes this reachable.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PlanStoryChapterRow } from "@/db/schema";
import type { StoryContext } from "@/lib/presentations/story/types";
import { isChapterId, CHAPTER_IDS } from "../types";

const m = vi.hoisted(() => ({ loadStoryContext: vi.fn(), listStoryChapters: vi.fn() }));

vi.mock("@/lib/presentations/story/load-context", () => ({ loadStoryContext: m.loadStoryContext }));
// `resolveChapterText` stays REAL — the loader's job is to resolve, and a
// reimplementation in the mock would make the assertions echo the mock.
vi.mock("@/lib/presentations/story/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../repo")>()),
  listStoryChapters: m.listStoryChapters,
}));

import { loadPlanStoryInput } from "../load-for-export";
import {
  PLAN_STORY_OPTIONS_DEFAULT,
  printedChapters,
} from "@/lib/presentations/pages/plan-story/options-schema";

const CLIENT = "c1a11111-2222-4333-8444-555555555555";
const FIRM = "f1a11111-2222-4333-8444-555555555555";

const STORY: StoryContext = {
  household: { firstNames: "Alan and Teresa", householdName: "the Bradshaw household" },
  scenarioLabel: "Base Case",
  documentRole: "standalone",
  hasProposal: false,
  strategies: [],
  goals: [],
  facts: [],
};

// The page's REAL parsed options — the loader reads `sections` off them to
// decide which chapters' facts it has to load.
const OPTIONS = {
  ...PLAN_STORY_OPTIONS_DEFAULT,
  scenarioId: "base",
  scenarioLabel: "Base Case",
};

const row = (over: Partial<PlanStoryChapterRow>): PlanStoryChapterRow => ({
  id: "row-1",
  clientId: CLIENT,
  scenarioId: "base",
  documentRole: "standalone",
  chapterId: "planInOnePage",
  generatedText: null,
  generatedAt: null,
  generatedByUserId: null,
  editedText: null,
  editedAt: null,
  sourceHash: null,
  aiSuppressed: false,
  error: null,
  reviewedAt: null,
  reviewedByUserId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

beforeEach(() => {
  m.loadStoryContext.mockReset();
  m.listStoryChapters.mockReset();
  m.loadStoryContext.mockResolvedValue(STORY);
  m.listStoryChapters.mockResolvedValue([]);
});

describe("isChapterId", () => {
  // Reads `CHAPTER_IDS` rather than a second list, so widening the union to
  // fourteen cannot leave the guard behind.
  it("accepts every id the registry actually holds", () => {
    for (const id of CHAPTER_IDS) expect(isChapterId(id)).toBe(true);
  });

  it("rejects an id that has been retired or renamed", () => {
    expect(isChapterId("whatYouUsedToHave")).toBe(false);
    expect(isChapterId("")).toBe(false);
  });
});

describe("loadPlanStoryInput — a row for a chapter this build no longer has", () => {
  it("drops it, keeps the rest, and says so", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    m.listStoryChapters.mockResolvedValue([
      row({ chapterId: "retiredChapter", editedText: "Orphaned words." }),
      row({ chapterId: "whatYouHave", editedText: "Real words." }),
    ]);

    const input = await loadPlanStoryInput(CLIENT, FIRM, OPTIONS);

    // The unknown key never reaches the view model, where nothing reads it and
    // nothing reports it — the chapter would print its deterministic narrative
    // while the advisor's own words sat in a row with no home.
    expect(input.text).toEqual({ whatYouHave: "Real words." });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[plan-story]"), "retiredChapter");
    warn.mockRestore();
  });

  it("still exports rather than throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    m.listStoryChapters.mockResolvedValue([row({ chapterId: "gone", editedText: "Orphaned." })]);
    // An export must not fail because storage remembers more than the code does.
    await expect(loadPlanStoryInput(CLIENT, FIRM, OPTIONS)).resolves.toMatchObject({ text: {} });
    warn.mockRestore();
  });
});

/**
 * What this deck PRINTS reaches the loader, so it can skip the facts nothing on
 * this deck will read — the life-cover solve, mainly, which is by far the most
 * expensive thing that loader can run and used to run on every export.
 *
 * ⚠️⚠️ The direction that matters is one-way. Loading too much costs seconds;
 * loading too little makes a chapter print its honest empty state on a document
 * handed to a client, and no gate, no page count and no type can see it. Which
 * is why the list is computed HERE from `printedChapters` — the same call the
 * render makes — rather than handed in by the caller.
 */
describe("loadPlanStoryInput — the printed chapter list", () => {
  it("hands the loader exactly the chapters this deck prints", async () => {
    await loadPlanStoryInput(CLIENT, FIRM, OPTIONS);

    expect(m.loadStoryContext).toHaveBeenCalledWith(
      expect.objectContaining({ chapters: printedChapters(OPTIONS) }),
    );
  });

  /**
   * …and it is DERIVED, not hardcoded. Kills a loader that passes the whole arc
   * (which would keep the old cost) and one that passes a second, hand-written
   * list that drifts from what the render prints.
   */
  it("drops a chapter the advisor switched off, and keeps the rest", async () => {
    await loadPlanStoryInput(CLIENT, FIRM, {
      ...OPTIONS,
      sections: { ...OPTIONS.sections, protectingYourFamily: false },
    });

    const { chapters } = m.loadStoryContext.mock.calls[0][0];
    expect(chapters).not.toContain("protectingYourFamily");
    expect(chapters).toContain("planInOnePage");
  });
});
