import { describe, it, expect, vi } from "vitest";
import {
  ensureRetirementComparisonAiSummaries,
  ensureInvestmentProposalAiSummaries,
} from "../ensure-ai-summaries";
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

  it("passes the page's baseline through to the generator", async () => {
    const generate = fakeGenerate({ hash: "h" });
    const pages = [rcPage({ baselineScenarioId: "s2" })];

    await ensureRetirementComparisonAiSummaries(ARGS.clientId, ARGS.firmId, pages, { generate });

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ baselineScenarioId: "s2", scenarioId: "scn-1" }),
    );
  });
});

// ── Investment Proposal ─────────────────────────────────────────────────────

describe("ensureInvestmentProposalAiSummaries", () => {
  const page = (options: Record<string, unknown>) => ({ pageId: "investmentProposal", options });
  const base = {
    proposalId: "p1", tone: "plain", length: "medium",
    sections: { commentary: true },
    ai: { generatedText: "", generatedAt: "", sourceHash: "", customInstructions: "" },
  };

  it("fills in commentary the page does not have yet", async () => {
    const generate = vi.fn(async () => ({ markdown: "New copy.", generatedAt: "t", hash: "h1", cached: false }));
    const [out] = await ensureInvestmentProposalAiSummaries("c1", "f1", [page(base)], { generate });
    expect((out.options as typeof base).ai.generatedText).toBe("New copy.");
  });

  it("keeps the advisor's hand-edited text when the prompt hash is unchanged", async () => {
    const generate = vi.fn(async () => ({ markdown: "Regenerated.", generatedAt: "t", hash: "h1", cached: true }));
    const edited = { ...base, ai: { ...base.ai, generatedText: "Hand-edited.", sourceHash: "h1" } };
    const [out] = await ensureInvestmentProposalAiSummaries("c1", "f1", [page(edited)], { generate });
    expect((out.options as typeof base).ai.generatedText).toBe("Hand-edited.");
  });

  it("skips a page whose commentary section is switched off", async () => {
    const generate = vi.fn();
    const off = { ...base, sections: { commentary: false } };
    await ensureInvestmentProposalAiSummaries("c1", "f1", [page(off)], { generate });
    expect(generate).not.toHaveBeenCalled();
  });

  it("skips a page with no proposal picked", async () => {
    const generate = vi.fn();
    await ensureInvestmentProposalAiSummaries("c1", "f1", [page({ ...base, proposalId: "" })], { generate });
    expect(generate).not.toHaveBeenCalled();
  });

  it("leaves the page untouched when generation throws, so the deck still renders", async () => {
    const generate = vi.fn(async () => { throw new Error("azure down"); });
    const edited = { ...base, ai: { ...base.ai, generatedText: "Old copy." } };
    const [out] = await ensureInvestmentProposalAiSummaries("c1", "f1", [page(edited)], { generate });
    expect((out.options as typeof base).ai.generatedText).toBe("Old copy.");
  });

  it("leaves a page of another type alone", async () => {
    const generate = vi.fn();
    const other = { pageId: "assetAllocation", options: {} };
    const [out] = await ensureInvestmentProposalAiSummaries("c1", "f1", [other], { generate });
    expect(out).toBe(other);
    expect(generate).not.toHaveBeenCalled();
  });
});
