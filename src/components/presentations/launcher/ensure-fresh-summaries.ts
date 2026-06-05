import type { RetirementComparisonOptions } from "@/lib/presentations/pages/retirement-comparison/types";

/** A page entry as sent to the export route. `options` is page-shaped. */
export interface PageDescriptor {
  pageId: string;
  options: unknown;
  scenarioOverride?: string | null;
}

interface AiResponse {
  markdown: string;
  generatedAt: string;
  hash: string;
}

export interface EnsureResult {
  /** Descriptors to send to the export route — fresh text already inlined. */
  pages: PageDescriptor[];
  /** Options that changed, by their index in the input array (for dispatch). */
  updates: { index: number; options: RetirementComparisonOptions }[];
  /** First error encountered, if any. Non-fatal: export proceeds regardless. */
  error: string | null;
}

/**
 * Ensure every Retirement Comparison page in `pages` carries a current AI
 * summary before the deck is exported. For each RC page that shows the summary
 * and has a comparison scenario selected, call the AI endpoint and compare the
 * returned prompt hash to the stored `sourceHash`:
 *   - hash matches AND text present  → keep stored text (preserves edits).
 *   - hash differs OR text empty     → overwrite with the fresh summary.
 * The endpoint's Redis cache makes the LLM free when nothing changed; the
 * projection/MC pass behind the hash is the accepted wait. Failures are
 * surfaced via `error` but never throw — the report still ships.
 */
export async function ensureFreshSummaries(
  pages: PageDescriptor[],
  opts: { clientId: string; fetchImpl?: typeof fetch },
): Promise<EnsureResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const out = pages.slice();
  const updates: EnsureResult["updates"] = [];
  let error: string | null = null;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (page.pageId !== "retirementComparison") continue;
    const o = page.options as RetirementComparisonOptions;
    if (!o.showAiSummary || !o.scenarioId) continue;

    try {
      const res = await doFetch(
        `/api/clients/${opts.clientId}/presentations/retirement-comparison-ai`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scenarioId: o.scenarioId,
            tone: o.ai.tone,
            length: o.ai.length,
            customInstructions: o.ai.customInstructions,
            targetConfidence: o.maxSpend.targetConfidence,
            force: false,
          }),
        },
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `Request failed (${res.status})`);
      }
      const j = (await res.json()) as AiResponse;
      const stale = j.hash !== o.ai.sourceHash || o.ai.generatedText === "";
      if (stale) {
        const nextOptions: RetirementComparisonOptions = {
          ...o,
          ai: {
            ...o.ai,
            generatedText: j.markdown,
            generatedAt: j.generatedAt,
            sourceHash: j.hash,
          },
        };
        out[i] = { ...page, options: nextOptions };
        updates.push({ index: i, options: nextOptions });
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "Summary generation failed.";
    }
  }

  return { pages: out, updates, error };
}
