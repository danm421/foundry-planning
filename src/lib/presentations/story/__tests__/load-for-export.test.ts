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

const CLIENT = "c1a11111-2222-4333-8444-555555555555";
const FIRM = "f1a11111-2222-4333-8444-555555555555";

const STORY: StoryContext = {
  household: { firstNames: "Alan and Teresa", householdName: "the Bradshaw household" },
  scenarioLabel: "Base Case",
  documentRole: "standalone",
  hasProposal: false,
  strategies: [],
  facts: [],
};

const OPTIONS = { scenarioId: "base", documentRole: "standalone" as const, scenarioLabel: "Base Case" };

const row = (over: Partial<PlanStoryChapterRow>): PlanStoryChapterRow => ({
  id: "row-1",
  clientId: CLIENT,
  scenarioId: "base",
  documentRole: "standalone",
  chapterId: "planInOnePage",
  generatedText: null,
  editedText: null,
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
