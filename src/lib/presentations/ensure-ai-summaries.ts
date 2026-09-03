// Server-side counterpart to the launcher's client `ensureFreshSummaries`: walk
// a deck's pages and, for each Retirement Comparison page that shows the AI
// summary and has a comparison scenario, generate the commentary and inline it
// into the page options before rendering. Runs as the final data step of a
// background presentation run (and inline for synchronous preview/download), so
// the AI sees the fully-computed projection/MC rather than firing up front.
//
// Preserve-edits semantics match the client: the generator returns the prompt
// hash; if it equals the page's stored `sourceHash` and there is existing text,
// the advisor's (possibly hand-edited) text is kept. Otherwise the page is
// refreshed. Best-effort per page — a generator failure leaves that page's
// existing text untouched and never throws, so the deck still renders.

import {
  generateRetirementComparisonAi,
  type GeneratedRetirementComparisonAi,
} from "./pages/retirement-comparison/generate-ai";
import type { RetirementComparisonOptions } from "./pages/retirement-comparison/types";
import {
  generateInvestmentProposalAi,
  type GeneratedInvestmentProposalAi,
} from "./pages/investment-proposal/generate-ai";
import type { InvestmentProposalOptions } from "./pages/investment-proposal/options-schema";
import {
  generateScenarioComparisonAi,
  prepareScenarioComparisonAiInputs,
  type GeneratedScenarioComparisonAi,
  type GenerateScenarioComparisonAiArgs,
  type ScenarioComparisonAiInputs,
} from "./pages/scenario-comparison/generate-ai";
import type {
  ScenarioComparisonBandAi,
  ScenarioComparisonOptions,
} from "./pages/scenario-comparison/types";

/** Minimal page shape — matches both the export BodySchema pages and previews. */
interface PageLike {
  pageId: string;
  options: unknown;
  scenarioOverride?: string | null;
}

interface Deps {
  /** Injectable for tests; defaults to the real Redis-cached Azure generator. */
  generate?: (args: {
    clientId: string;
    firmId: string;
    scenarioId: string;
    tone: RetirementComparisonOptions["ai"]["tone"];
    length: RetirementComparisonOptions["ai"]["length"];
    customInstructions: string;
    targetConfidence: number;
    force: boolean;
  }) => Promise<GeneratedRetirementComparisonAi>;
}

export async function ensureRetirementComparisonAiSummaries<T extends PageLike>(
  clientId: string,
  firmId: string,
  pages: T[],
  deps: Deps = {},
): Promise<T[]> {
  const generate = deps.generate ?? generateRetirementComparisonAi;

  return Promise.all(
    pages.map(async (page) => {
      if (page.pageId !== "retirementComparison") return page;
      const o = page.options as RetirementComparisonOptions;
      if (!o.showAiSummary || !o.scenarioId) return page;

      try {
        const res = await generate({
          clientId,
          firmId,
          scenarioId: o.scenarioId,
          tone: o.ai.tone,
          length: o.ai.length,
          customInstructions: o.ai.customInstructions,
          targetConfidence: o.maxSpend.targetConfidence,
          force: false,
        });
        const stale = res.hash !== o.ai.sourceHash || o.ai.generatedText === "";
        if (!stale) return page;
        const nextOptions: RetirementComparisonOptions = {
          ...o,
          ai: {
            ...o.ai,
            generatedText: res.markdown,
            generatedAt: res.generatedAt,
            sourceHash: res.hash,
          },
        };
        return { ...page, options: nextOptions } as T;
      } catch (err) {
        // Non-fatal: keep whatever text the page already carries so the deck
        // still renders (mirrors the client helper's surfaced-but-never-thrown
        // failure mode).
        console.error("[ensure-ai-summaries] generation failed (non-fatal)", err);
        return page;
      }
    }),
  );
}

interface ProposalDeps {
  /** Injectable for tests; defaults to the real Redis-cached Azure generator. */
  generate?: (args: {
    clientId: string;
    firmId: string;
    proposalId: string;
    firstNames: string;
    tone: InvestmentProposalOptions["tone"];
    length: InvestmentProposalOptions["length"];
    customInstructions: string;
    force: boolean;
  }) => Promise<GeneratedInvestmentProposalAi>;
  firstNames?: string;
}

/**
 * Same contract as its retirement-comparison sibling: generate before render so
 * a preview and the deck it previews say the same thing, preserve a hand-edited
 * text whose prompt hash still matches, and never throw — a generator failure
 * leaves the page's existing text alone and the deck still renders.
 */
export async function ensureInvestmentProposalAiSummaries<T extends PageLike>(
  clientId: string,
  firmId: string,
  pages: T[],
  deps: ProposalDeps = {},
): Promise<T[]> {
  const generate = deps.generate ?? generateInvestmentProposalAi;

  return Promise.all(
    pages.map(async (page) => {
      if (page.pageId !== "investmentProposal") return page;
      const o = page.options as InvestmentProposalOptions;
      if (!o.sections.commentary || !o.proposalId) return page;

      try {
        const res = await generate({
          clientId,
          firmId,
          proposalId: o.proposalId,
          firstNames: deps.firstNames ?? "",
          tone: o.tone,
          length: o.length,
          customInstructions: o.ai.customInstructions,
          force: false,
        });
        const stale = res.hash !== o.ai.sourceHash || o.ai.generatedText === "";
        if (!stale) return page;
        const nextOptions: InvestmentProposalOptions = {
          ...o,
          ai: {
            ...o.ai,
            generatedText: res.markdown,
            generatedAt: res.generatedAt,
            sourceHash: res.hash,
          },
        };
        return { ...page, options: nextOptions } as T;
      } catch (err) {
        console.error("[ensure-ai-summaries] proposal generation failed (non-fatal)", err);
        return page;
      }
    }),
  );
}

// ── Scenario Comparison ─────────────────────────────────────────────────────

interface ScenarioComparisonDeps {
  /** Injectable for tests; defaults to the real loader + view model. */
  prepare?: (
    clientId: string,
    firmId: string,
    options: ScenarioComparisonOptions,
  ) => Promise<ScenarioComparisonAiInputs | null>;
  /** Injectable for tests; defaults to the real Redis-cached Azure generator. */
  generate?: (
    args: GenerateScenarioComparisonAiArgs,
  ) => Promise<GeneratedScenarioComparisonAi>;
}

/**
 * Same best-effort contract as its siblings, with one difference that matters:
 * this page carries a narrative PER SCENARIO, so the returned bands are merged
 * into `ai.byScenario` one at a time. Rebuilding that record wholesale would
 * discard the text the advisor already has for scenarios the generator did not
 * return — which is the whole reason the staleness hash is per band rather than
 * per page.
 */
export async function ensureScenarioComparisonAiSummaries<T extends PageLike>(
  clientId: string,
  firmId: string,
  pages: T[],
  deps: ScenarioComparisonDeps = {},
): Promise<T[]> {
  const prepare = deps.prepare ?? prepareScenarioComparisonAiInputs;
  const generate = deps.generate ?? generateScenarioComparisonAi;

  return Promise.all(
    pages.map(async (page) => {
      if (page.pageId !== "scenarioComparison") return page;
      const o = page.options as ScenarioComparisonOptions;
      // Sheet two — the only place a narrative appears — is dropped whenever
      // the page has no bands, so generating one would be pure spend on text
      // that can never print.
      if (!o.showTradeoffBands) return page;
      if (o.scenarioIds.filter(Boolean).length === 0) return page;

      try {
        const inputs = await prepare(clientId, firmId, o);
        if (!inputs) return page;

        const { byScenario } = await generate({
          clientId,
          householdName: inputs.householdName,
          firstNames: inputs.firstNames,
          columns: inputs.columns,
          rows: inputs.rows,
          bands: inputs.bands,
          tone: o.ai.tone,
          customInstructions: o.ai.customInstructions,
          sentenceBudget: inputs.sentenceBudget,
          stored: o.ai.byScenario,
          force: false,
        });

        const freshIds = Object.keys(byScenario);
        if (freshIds.length === 0) return page;

        const merged: Record<string, ScenarioComparisonBandAi> = { ...o.ai.byScenario };
        for (const id of freshIds) {
          const res = byScenario[id];
          merged[id] = {
            generatedText: res.markdown,
            generatedAt: res.generatedAt,
            sourceHash: res.hash,
          };
        }
        const nextOptions: ScenarioComparisonOptions = {
          ...o,
          ai: { ...o.ai, byScenario: merged },
        };
        return { ...page, options: nextOptions } as T;
      } catch (err) {
        console.error(
          "[ensure-ai-summaries] scenario comparison generation failed (non-fatal)",
          err,
        );
        return page;
      }
    }),
  );
}
