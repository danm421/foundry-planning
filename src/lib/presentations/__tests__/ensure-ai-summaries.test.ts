import { describe, it, expect, vi } from "vitest";
import { ensureRetirementComparisonAiSummaries } from "../ensure-ai-summaries";
import { RETIREMENT_COMPARISON_OPTIONS_DEFAULT } from "../pages/retirement-comparison/options-schema";
import type { RetirementComparisonOptions } from "../pages/retirement-comparison/types";
import type { GeneratedRetirementComparisonAi } from "../pages/retirement-comparison/generate-ai";

function rcPage(overrides: Partial<RetirementComparisonOptions> = {}, aiOverrides = {}) {
  return {
    pageId: "retirementComparison" as const,
    options: {
      ...RETIREMENT_COMPARISON_OPTIONS_DEFAULT,
      scenarioId: "scn-1",
      ...overrides,
      ai: { ...RETIREMENT_COMPARISON_OPTIONS_DEFAULT.ai, ...aiOverrides },
    } satisfies RetirementComparisonOptions,
  };
}

function fakeGenerate(
  result: Partial<GeneratedRetirementComparisonAi>,
): () => Promise<GeneratedRetirementComparisonAi> {
  return vi.fn(async () => ({
    markdown: "FRESH",
    generatedAt: "2026-06-26T00:00:00.000Z",
    hash: "hash-new",
    cached: false,
    ...result,
  }));
}

const ARGS = { clientId: "c1", firmId: "f1" } as const;

describe("ensureRetirementComparisonAiSummaries", () => {
  it("injects fresh text when the prompt hash differs from the stored sourceHash", async () => {
    const generate = fakeGenerate({ markdown: "FRESH", hash: "hash-new" });
    const pages = [rcPage({}, { sourceHash: "hash-old", generatedText: "stale text" })];

    const out = await ensureRetirementComparisonAiSummaries(ARGS.clientId, ARGS.firmId, pages, { generate });

    const ai = (out[0].options as RetirementComparisonOptions).ai;
    expect(ai.generatedText).toBe("FRESH");
    expect(ai.sourceHash).toBe("hash-new");
    expect(ai.generatedAt).toBe("2026-06-26T00:00:00.000Z");
    expect(generate).toHaveBeenCalledOnce();
  });

  it("preserves advisor-edited text when the hash matches and text is present", async () => {
    const generate = fakeGenerate({ markdown: "FRESH", hash: "hash-same" });
    const pages = [rcPage({}, { sourceHash: "hash-same", generatedText: "MY EDIT" })];

    const out = await ensureRetirementComparisonAiSummaries(ARGS.clientId, ARGS.firmId, pages, { generate });

    expect((out[0].options as RetirementComparisonOptions).ai.generatedText).toBe("MY EDIT");
  });

  it("regenerates when stored text is empty even if the hash matches", async () => {
    const generate = fakeGenerate({ markdown: "FRESH", hash: "hash-same" });
    const pages = [rcPage({}, { sourceHash: "hash-same", generatedText: "" })];

    const out = await ensureRetirementComparisonAiSummaries(ARGS.clientId, ARGS.firmId, pages, { generate });

    expect((out[0].options as RetirementComparisonOptions).ai.generatedText).toBe("FRESH");
  });

  it("calls the generator with force:false so the Redis cache is honored", async () => {
    const generate = fakeGenerate({});
    const pages = [rcPage({}, { sourceHash: "x" })];

    await ensureRetirementComparisonAiSummaries(ARGS.clientId, ARGS.firmId, pages, { generate });

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "c1", firmId: "f1", scenarioId: "scn-1", force: false }),
    );
  });

  it("skips RC pages with showAiSummary off or no scenario, and non-RC pages", async () => {
    const generate = fakeGenerate({});
    const pages = [
      rcPage({ showAiSummary: false }),
      rcPage({ scenarioId: "" }),
      { pageId: "cashFlow" as const, options: { range: "retirement" } },
    ];

    const out = await ensureRetirementComparisonAiSummaries(ARGS.clientId, ARGS.firmId, pages, { generate });

    expect(generate).not.toHaveBeenCalled();
    expect(out).toEqual(pages); // untouched
  });

  it("is best-effort: a generator failure leaves the page's existing text and does not throw", async () => {
    const generate = vi.fn(async () => {
      throw new Error("LLM down");
    });
    const pages = [rcPage({}, { sourceHash: "old", generatedText: "previous" })];

    const out = await ensureRetirementComparisonAiSummaries(ARGS.clientId, ARGS.firmId, pages, { generate });

    expect((out[0].options as RetirementComparisonOptions).ai.generatedText).toBe("previous");
  });
});
