// One chapter, end to end: cache → model → gates → one retry → deterministic
// fallback. Every dependency is injectable, so the whole control flow is
// tested without an LLM (the pattern ensure-ai-summaries.ts already uses).
//
// Nothing here throws. A chapter that cannot be generated renders its
// deterministic narrative and is flagged, because a failed model call must
// never be able to blank a page or block an export.
import { callAIExtraction } from "@/lib/extraction/azure-client";
import {
  hashAiRequest,
  getCachedAnalysis,
  setCachedAnalysis,
  type AiCacheValue,
} from "@/lib/presentations/ai-cache";
import { buildChapterPrompt } from "./chapters/prompts";
import { CHAPTERS } from "./chapters/registry";
import { runGates, type GateFailure } from "./validate";
import type { ChapterId, StoryContext } from "./types";

/** Pinned explicitly rather than through AZURE_ANALYSIS_MODEL, matching the
 *  shipped comparison generator (pages/retirement-comparison/generate-ai.ts).
 *  `callAIExtraction` passes an explicit deployment name straight through. */
const MODEL = "gpt-5.4";

/** What the advisor is told when the call itself failed. The real error is
 *  logged, never surfaced: it is Azure's wording, not ours. */
const UNAVAILABLE = "The writing assistant was unavailable.";

export interface GeneratedChapter {
  chapterId: ChapterId;
  markdown: string;
  /** SHA-256 of the first-attempt prompt — the staleness key. */
  sourceHash: string;
  /** True when the gates rejected both attempts (or the call failed) and the
   *  deterministic narrative is what rendered. */
  aiSuppressed: boolean;
  /** Why it was suppressed. Surfaced in the review panel; never in the PDF. */
  failures: GateFailure[];
  /**
   * Set instead of `failures` when the model never produced a draft. An outage
   * is not a gate finding: `GateId` has four values and none of them is "the
   * assistant was down", so filing one under `facts` would tell the advisor the
   * model wrote a figure it never wrote.
   */
  error: string | null;
  generatedAt: string;
  cached: boolean;
}

export interface GenerateChapterDeps {
  generate?: (system: string, user: string) => Promise<string>;
  getCached?: (clientId: string, hash: string) => Promise<AiCacheValue | null>;
  setCached?: (clientId: string, hash: string, value: AiCacheValue) => Promise<void>;
}

export interface GenerateChapterArgs {
  clientId: string;
  chapterId: ChapterId;
  ctx: StoryContext;
  voiceSamples: string[];
  /** Bypass the cache and force a fresh call — the panel's Regenerate action. */
  force?: boolean;
  deps?: GenerateChapterDeps;
}

/**
 * Gate 3 is the only gate that can report the same thing twice: it maps over
 * sentences with no seen-set, so one offending sentence written in two
 * paragraphs yields two byte-identical failures. Gates 1, 2 and 4 are each
 * structurally incapable of it. Saying a rule twice adds nothing to the retry
 * prompt and reads as a defect in the review panel, so both are deduplicated
 * here rather than in the frozen gates.
 */
function dedupe(failures: GateFailure[]): GateFailure[] {
  const seen = new Set<string>();
  return failures.filter((f) => {
    const key = [f.gate, f.message].join("::");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Gate 3's message explains one of the two shapes it rejects — instructing the
 * reader to trade a named holding. It also fires on any clause that merely
 * OPENS with one of thirteen base-form action verbs, with no object test, which
 * is exactly what a chapter does when it quotes an advisor's strategy label
 * ("Convert to Roth is the first change"). Relayed alone, the message sends the
 * model hunting for a holding that is not there, and contradicts the system
 * prompt's own verb rule.
 *
 * This supplies the missing half. It deliberately does NOT restate the thirteen
 * verbs: the same request's system prompt already lists them, and a second copy
 * here would be a third place for that list to drift.
 */
const ADVICE_NOTE: GateFailure = {
  gate: "advice",
  message:
    "A sentence can break that rule for where an action word sits rather than for naming a holding: " +
    "do not open a sentence or a clause with one of the action words listed in your instructions, " +
    "and never repeat one of the advisor's strategy labels word for word.",
};

/**
 * What the single retry is actually told: the deduplicated failures, with the
 * advice note beside the ones it explains.
 *
 * Deliberately NOT capped. A cap cannot make the retry more likely to pass —
 * every gate must clear for the draft to be used, so a rule left unnamed is a
 * rule free to survive into the attempt that decides whether the client reads
 * the model's chapter or the deterministic one. The worst case measured against
 * the shipped gates, a draft breaking all four at once, is 25 failures and about
 * 3k characters of prompt.
 */
function retryNotes(failures: GateFailure[]): GateFailure[] {
  const notes = dedupe(failures);
  const lastAdvice = notes.findLastIndex((f) => f.gate === "advice");
  if (lastAdvice < 0) return notes;
  return [...notes.slice(0, lastAdvice + 1), ADVICE_NOTE, ...notes.slice(lastAdvice + 1)];
}

export async function generateChapter(args: GenerateChapterArgs): Promise<GeneratedChapter> {
  const { clientId, chapterId, ctx, voiceSamples } = args;
  const generate = args.deps?.generate ?? ((s: string, u: string) => callAIExtraction(s, u, MODEL));
  const getCached = args.deps?.getCached ?? getCachedAnalysis;
  const setCached = args.deps?.setCached ?? setCachedAnalysis;

  const first = buildChapterPrompt(chapterId, ctx, voiceSamples, []);
  const sourceHash = hashAiRequest(first);

  const fallback = (failures: GateFailure[], error: string | null = null): GeneratedChapter => ({
    chapterId,
    markdown: CHAPTERS[chapterId].narrate(ctx).join("\n\n"),
    sourceHash,
    aiSuppressed: true,
    failures,
    error,
    generatedAt: new Date().toISOString(),
    cached: false,
  });

  if (!args.force) {
    const hit = await getCached(clientId, sourceHash);
    if (hit) {
      return {
        chapterId, markdown: hit.markdown, sourceHash, aiSuppressed: false,
        failures: [], error: null, generatedAt: hit.generatedAt, cached: true,
      };
    }
  }

  /**
   * A draft that is blank after trimming clears all four gates — there is
   * nothing in it to reject — so without this it would be cached and rendered
   * as an empty chapter. Thrown rather than returned so one handler covers both
   * attempts, and treated as an outage rather than as a retry: a blank
   * completion is a truncation or a content filter, and neither is something a
   * retry prompt can name.
   */
  const draft = async (prompt: { system: string; user: string }): Promise<string> => {
    const text = (await generate(prompt.system, prompt.user)).trim();
    if (!text) throw new Error("model returned an empty chapter");
    return text;
  };

  try {
    const attempt1 = await draft(first);
    let markdown = attempt1;
    const failures = runGates(attempt1, ctx.facts);

    if (failures.length > 0) {
      const retry = buildChapterPrompt(chapterId, ctx, voiceSamples, retryNotes(failures));
      const attempt2 = await draft(retry);
      const retryFailures = dedupe(runGates(attempt2, ctx.facts));
      if (retryFailures.length > 0) return fallback(retryFailures);
      markdown = attempt2;
    }

    const generatedAt = new Date().toISOString();
    // A cache write that fails must not cost the chapter we already hold: a miss
    // on the next run is cheap, suppressing a clean chapter is not.
    await setCached(clientId, sourceHash, { markdown, generatedAt }).catch((err: unknown) =>
      console.warn("[plan-story] cache write failed (non-fatal)", chapterId, err),
    );
    return {
      chapterId, markdown, sourceHash, aiSuppressed: false,
      failures: [], error: null, generatedAt, cached: false,
    };
  } catch (err) {
    // Non-fatal by design — mirrors ensure-ai-summaries.ts.
    console.error("[plan-story] generation failed (non-fatal)", chapterId, err);
    return fallback([], UNAVAILABLE);
  }
}
