// The export path's side of the plan story, tested where the export lives.
//
// Three claims, and the first is the whole feature: what the advisor wrote is
// what the client reads. The other two are the promises that make an export
// safe to press — nothing is generated at export time, and the two
// scenario-shaped values the loader derives (the proposed ref the story
// narrates, and the scope its stored text is keyed on) are the ones the review
// panel and the write routes already agreed on.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PlanStoryChapterRow } from "@/db/schema";
import type { StoryContext } from "@/lib/presentations/story/types";

const m = vi.hoisted(() => ({
  loadStoryContext: vi.fn(),
  listStoryChapters: vi.fn(),
}));

vi.mock("@/lib/presentations/story/load-context", () => ({
  loadStoryContext: m.loadStoryContext,
}));

// CORRECTION 3: mock ONLY the DB read. `resolveChapterText` stays REAL — it is
// the thing under test. Reimplementing it inside the mock would make the
// headline assertion below an echo of the mock, green over a resolver that
// ignored `editedText` entirely, and green over one that disagrees with the
// shipped rule (a whitespace-only edit is not an edit).
vi.mock("@/lib/presentations/story/repo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/presentations/story/repo")>()),
  listStoryChapters: m.listStoryChapters,
}));

// No model, at all. `generate.ts` reaches the assistant through
// `callAIExtractionWithMeta` — that is the export this must watch, not the
// plain `callAIExtraction` no story code has ever called. The stubs throw
// rather than resolve so a regression that generates on demand fails loudly
// here instead of quietly making every export slower and more expensive.
const azure = vi.hoisted(() => {
  const refuse = () => {
    throw new Error("export must not call the model");
  };
  return {
    callAIExtractionWithMeta: vi.fn(refuse),
    callAIExtraction: vi.fn(refuse),
  };
});
vi.mock("@/lib/extraction/azure-client", () => azure);

import { loadPlanStoryInput } from "@/lib/presentations/story/load-for-export";

const CLIENT = "c1a11111-2222-4333-8444-555555555555";
const FIRM = "f1a11111-2222-4333-8444-555555555555";
const SCENARIO = "5ce11111-2222-4333-8444-666666666666";

const STORY: StoryContext = {
  household: { firstNames: "Alan and Teresa", householdName: "the Bradshaw household" },
  scenarioLabel: "Retire at 62",
  documentRole: "standalone",
  hasProposal: true,
  strategies: [],
  facts: [],
};

const row = (over: Partial<PlanStoryChapterRow>): PlanStoryChapterRow => ({
  id: "row-1",
  clientId: CLIENT,
  scenarioId: SCENARIO,
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

const OPTIONS = {
  scenarioId: SCENARIO,
  documentRole: "standalone" as const,
  scenarioLabel: "Retire at 62",
};

beforeEach(() => {
  m.loadStoryContext.mockReset();
  m.listStoryChapters.mockReset();
  m.loadStoryContext.mockResolvedValue(STORY);
  m.listStoryChapters.mockResolvedValue([]);
  azure.callAIExtractionWithMeta.mockClear();
  azure.callAIExtraction.mockClear();
});

describe("loadPlanStoryInput", () => {
  it("prefers the advisor's edited text for the PDF", async () => {
    m.listStoryChapters.mockResolvedValue([
      row({ generatedText: "Model wrote this.", editedText: "Advisor wrote this." }),
    ]);

    const input = await loadPlanStoryInput(CLIENT, FIRM, OPTIONS);

    expect(input.text.planInOnePage).toBe("Advisor wrote this.");
  });

  /**
   * The same rule read the other way, and the one the shipped resolver and a
   * naive `editedText ?? generatedText` disagree about. Kills any resolver that
   * treats an empty edit box as an edit — which would print a blank chapter
   * where the model's approved words belong.
   */
  it("treats a whitespace-only edit as no edit, so the model's text still prints", async () => {
    m.listStoryChapters.mockResolvedValue([
      row({ generatedText: "Model wrote this.", editedText: "   " }),
    ]);

    const input = await loadPlanStoryInput(CLIENT, FIRM, OPTIONS);

    expect(input.text.planInOnePage).toBe("Model wrote this.");
  });

  it("leaves a never-generated chapter absent so the fallback narrates it", async () => {
    m.listStoryChapters.mockResolvedValue([row({ generatedText: "Model wrote this." })]);

    const input = await loadPlanStoryInput(CLIENT, FIRM, OPTIONS);

    expect(input.text.whatWeRecommend).toBeUndefined();
  });

  /**
   * A row with no words is a real state, not a hypothetical: marking a chapter
   * reviewed creates one, and so does saving an edit and then clearing it.
   * Storing "" for it would print an empty chapter instead of the deterministic
   * narrative — the view-model only falls back on a MISSING entry.
   */
  it("leaves a row that holds no words at all absent", async () => {
    m.listStoryChapters.mockResolvedValue([row({ reviewedAt: new Date(0) })]);

    const input = await loadPlanStoryInput(CLIENT, FIRM, OPTIONS);

    expect(input.text.planInOnePage).toBeUndefined();
  });

  it("makes no LLM call — export reads storage only", async () => {
    // A chapter that was never generated is exactly the state a lazy
    // generate-on-export would react to.
    m.listStoryChapters.mockResolvedValue([]);

    const input = await loadPlanStoryInput(CLIENT, FIRM, OPTIONS);

    expect(input.text).toEqual({});
    expect(azure.callAIExtractionWithMeta).not.toHaveBeenCalled();
    expect(azure.callAIExtraction).not.toHaveBeenCalled();
  });

  it("narrates the picked scenario and reads the text stored under it", async () => {
    await loadPlanStoryInput(CLIENT, FIRM, OPTIONS);

    expect(m.loadStoryContext).toHaveBeenCalledWith({
      clientId: CLIENT,
      firmId: FIRM,
      proposedRef: SCENARIO,
      scenarioLabel: "Retire at 62",
      documentRole: "standalone",
    });
    expect(m.listStoryChapters).toHaveBeenCalledWith(CLIENT, SCENARIO);
  });

  /**
   * The export's half of the same seam the generate route owns. Every other
   * fixture in this file is `"standalone"`, which is also the field's default
   * everywhere it is read — so without a non-default case, hardcoding the role in
   * the loader is invisible here, and the Executive brief's front-of-deck prose
   * is the thing that quietly stops existing.
   */
  it("carries the deck's document role into the story it narrates", async () => {
    await loadPlanStoryInput(CLIENT, FIRM, { ...OPTIONS, documentRole: "frontMatter" });

    expect(m.loadStoryContext).toHaveBeenCalledWith(
      expect.objectContaining({ documentRole: "frontMatter" }),
    );
  });

  /**
   * The two values are derived by different rules and must not be collapsed
   * into one: "" and "base" both mean "no proposed plan" to the story, and both
   * mean the literal "base" to storage — the scope the review panel translates
   * to and both write routes reach through `resolveStoryScenarioId`. A loader
   * that passed "" to `listStoryChapters` would read an empty set and silently
   * print deterministic prose over the advisor's own writing.
   */
  it.each([["", "an unset picker"], ["base", "the literal base"]])(
    "a base-only story (%s) has no proposed ref and reads the 'base' scope",
    async (scenarioId) => {
      await loadPlanStoryInput(CLIENT, FIRM, { ...OPTIONS, scenarioId });

      expect(m.loadStoryContext).toHaveBeenCalledWith(
        expect.objectContaining({ proposedRef: null }),
      );
      expect(m.listStoryChapters).toHaveBeenCalledWith(CLIENT, "base");
    },
  );
});
