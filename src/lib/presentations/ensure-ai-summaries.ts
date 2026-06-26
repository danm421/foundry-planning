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
