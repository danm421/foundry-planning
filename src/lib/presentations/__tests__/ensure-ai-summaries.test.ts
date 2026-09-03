import { describe, it, expect, vi } from "vitest";
import {
  ensureRetirementComparisonAiSummaries,
  ensureInvestmentProposalAiSummaries,
  ensureScenarioComparisonAiSummaries,
} from "../ensure-ai-summaries";
import { RETIREMENT_COMPARISON_OPTIONS_DEFAULT } from "../pages/retirement-comparison/options-schema";
import type { RetirementComparisonOptions } from "../pages/retirement-comparison/types";
import type { GeneratedRetirementComparisonAi } from "../pages/retirement-comparison/generate-ai";
import { SCENARIO_COMPARISON_OPTIONS_DEFAULT } from "../pages/scenario-comparison/options-schema";
import type {
  ScenarioComparisonOptions,
  TradeoffBand,
} from "../pages/scenario-comparison/types";
import type { ScenarioComparisonAiInputs } from "../pages/scenario-comparison/generate-ai";

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

// ── Scenario Comparison ─────────────────────────────────────────────────────

describe("ensureScenarioComparisonAiSummaries", () => {
  const band = (scenarioId: string): TradeoffBand => ({
    scenarioId,
    name: scenarioId,
    color: "#123456",
    chips: [],
    changeLines: [],
    moreChangeCount: 0,
    narrative: "",
    gains: [],
    costs: [],
  });

  const inputs = (): ScenarioComparisonAiInputs => ({
    householdName: "the Cooper household",
    firstNames: "Alan",
    sentenceBudget: 4,
    columns: [],
    rows: [],
    bands: [band("s1"), band("s2")],
  });

  const scPage = (
    overrides: Partial<ScenarioComparisonOptions> = {},
    aiOverrides: Partial<ScenarioComparisonOptions["ai"]> = {},
  ) => ({
    pageId: "scenarioComparison" as const,
    options: {
      ...SCENARIO_COMPARISON_OPTIONS_DEFAULT,
      scenarioIds: ["s1", "s2"],
      ...overrides,
      ai: { ...SCENARIO_COMPARISON_OPTIONS_DEFAULT.ai, ...aiOverrides },
    } satisfies ScenarioComparisonOptions,
  });

  const aiOf = (page: { options: unknown }) => (page.options as ScenarioComparisonOptions).ai;

  const prepare = () => vi.fn(async () => inputs());

  it("merges a returned band WITHOUT touching a band the generator left out", async () => {
    const generate = vi.fn(async () => ({
      byScenario: {
        s2: { markdown: "FRESH S2", generatedAt: "2026-09-02T00:00:00.000Z", hash: "h2-new" },
      },
      cached: false,
    }));
    const pages = [
      scPage({}, {
        byScenario: {
          s1: { generatedText: "MY EDIT", generatedAt: "t1", sourceHash: "h1" },
          s2: { generatedText: "stale", generatedAt: "t2", sourceHash: "h2-old" },
        },
      }),
    ];

    const out = await ensureScenarioComparisonAiSummaries("c1", "f1", pages, { prepare: prepare(), generate });

    // The untouched band keeps the advisor's edit, its timestamp AND its hash.
    expect(aiOf(out[0]).byScenario.s1).toEqual({
      generatedText: "MY EDIT",
      generatedAt: "t1",
      sourceHash: "h1",
    });
    expect(aiOf(out[0]).byScenario.s2).toEqual({
      generatedText: "FRESH S2",
      generatedAt: "2026-09-02T00:00:00.000Z",
      sourceHash: "h2-new",
    });
  });

  it("hands the generator the page's stored narratives, tone and budget, with force:false", async () => {
    const generate = vi.fn(async () => ({ byScenario: {}, cached: true }));
    const stored = { s1: { generatedText: "x", generatedAt: "t", sourceHash: "h" } };
    const pages = [scPage({}, { tone: "plain", customInstructions: "Be blunt.", byScenario: stored })];

    await ensureScenarioComparisonAiSummaries("c1", "f1", pages, { prepare: prepare(), generate });

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "c1",
        tone: "plain",
        customInstructions: "Be blunt.",
        sentenceBudget: 4,
        stored,
        force: false,
      }),
    );
  });

  it("returns the page untouched when nothing was stale", async () => {
    const generate = vi.fn(async () => ({ byScenario: {}, cached: true }));
    const pages = [scPage()];

    const out = await ensureScenarioComparisonAiSummaries("c1", "f1", pages, { prepare: prepare(), generate });

    expect(out[0]).toBe(pages[0]);
  });

  it("skips a page whose tradeoff bands are switched off — that sheet never prints", async () => {
    const generate = vi.fn();
    const prep = prepare();
    const pages = [scPage({ showTradeoffBands: false })];

    await ensureScenarioComparisonAiSummaries("c1", "f1", pages, { prepare: prep, generate });

    expect(prep).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("skips a page with no scenario chosen, and a page of another type", async () => {
    const generate = vi.fn();
    const prep = prepare();
    const pages = [scPage({ scenarioIds: [] }), { pageId: "cashFlow" as const, options: {} }];

    const out = await ensureScenarioComparisonAiSummaries("c1", "f1", pages, { prepare: prep, generate });

    expect(prep).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(out).toEqual(pages);
  });

  it("returns the page untouched when there is nothing to narrate", async () => {
    const generate = vi.fn();
    const pages = [scPage()];

    const out = await ensureScenarioComparisonAiSummaries("c1", "f1", pages, {
      prepare: vi.fn(async () => null),
      generate,
    });

    expect(generate).not.toHaveBeenCalled();
    expect(out[0]).toBe(pages[0]);
  });

  it("is best-effort: a generator failure leaves every stored band alone and does not throw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const generate = vi.fn(async () => {
      throw new Error("azure down");
    });
    const stored = { s1: { generatedText: "previous", generatedAt: "t", sourceHash: "h" } };
    const pages = [scPage({}, { byScenario: stored })];

    const out = await ensureScenarioComparisonAiSummaries("c1", "f1", pages, { prepare: prepare(), generate });

    expect(aiOf(out[0]).byScenario).toEqual(stored);
    vi.restoreAllMocks();
  });
});
