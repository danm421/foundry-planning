// One chapter, end to end: cache → model → gates → one retry → deterministic
// fallback. Every dependency is injectable, so the whole control flow is
// tested without an LLM (the pattern ensure-ai-summaries.ts already uses).
//
// Nothing here throws. A chapter that cannot be generated renders its
// deterministic narrative and is flagged, because a failed model call must
// never be able to blank a page or block an export.
import { callAIExtractionWithMeta } from "@/lib/extraction/azure-client";
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
 *  `callAIExtractionWithMeta` passes an explicit deployment name straight
 *  through. */
const MODEL = "gpt-5.4";

/** What the advisor is told when the call itself failed. The real error is
 *  logged, never surfaced: it is Azure's wording, not ours. */
const UNAVAILABLE = "The writing assistant was unavailable.";

/** …and when it answered with a stub. Deliberately NOT the outage wording: the
 *  assistant was available and replied, and what it replied is the reason. */
const TOO_SHORT = "The writing assistant returned too little text to use.";

/** A heading is a label, not a sentence — the same call `validate/voice.ts`
 *  makes when it measures rhythm. Load-bearing here rather than tidy: without
 *  it `"# Your plan holds"` counts three words and clears the floor. */
const HEADING_LINE_RE = /^ {0,3}#{1,6}\s/u;

/**
 * The floor below which a draft is not a chapter.
 *
 * The gates cannot supply this. All four judge what prose SAYS, so a draft with
 * nothing in it to bite on clears every one of them: `runGates` returns no
 * failures for `"#"`, `"---"`, `"..."`, a bare code fence, or `"Hello."`.
 * Without a floor any of those renders as the client's chapter and is written to
 * a 30-day cache that `ai-cache.ts` cannot delete.
 *
 * It catches degenerate stubs and nothing else. Truncation — the other way half
 * a chapter arrives — is caught at the source by `finish_reason`, so this number
 * does not have to reach for it, and must not: it is pinned between two
 * measurements with one word of room between them.
 *
 *   1  the largest stub above, once heading lines are dropped ("Hello.")
 *   3  the SHORTEST narrative this module itself publishes — `whatYouHave` on a
 *      debts-only pack, "You owe $300K." (pinned by `narratives.test.ts`)
 *
 * A floor above 3 rejects a chapter the app's own narrator considers complete:
 * it tells the advisor the assistant was unavailable when it answered cleanly,
 * hands them no finding to act on, and re-spends a model call on every render
 * because nothing is cached. `generate.test.ts` runs all of `CHAPTERS` against
 * this number so the floor and the narrators cannot drift apart.
 */
const MIN_CHAPTER_WORDS = 3;

/**
 * Words that carry prose: heading lines dropped, then tokens made only of
 * markdown decoration ignored. `---`, `...`, `>` and a code fence contribute
 * nothing, so a draft made entirely of them counts zero without needing a strip
 * pass per syntax.
 */
function hasSubstance(markdown: string): boolean {
  const words = markdown
    .split(/\r?\n/u)
    .filter((line) => !HEADING_LINE_RE.test(line))
    .join(" ")
    .split(/\s+/u)
    .filter((token) => /[\p{L}\p{N}]/u.test(token));
  return words.length >= MIN_CHAPTER_WORDS;
}

/** Thrown by the substance floor, so the handler can tell a stub from an outage
 *  and keep the findings the first attempt already produced. */
class ThinDraftError extends Error {}

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
 * the model's chapter or the deterministic one. That argument needs no number,
 * which is just as well: the size figures once quoted here were not reproducible
 * and are withdrawn.
 */
function retryNotes(failures: GateFailure[]): GateFailure[] {
  const notes = dedupe(failures);
  const lastAdvice = notes.findLastIndex((f) => f.gate === "advice");
  if (lastAdvice < 0) return notes;
  return [...notes.slice(0, lastAdvice + 1), ADVICE_NOTE, ...notes.slice(lastAdvice + 1)];
}

export async function generateChapter(args: GenerateChapterArgs): Promise<GeneratedChapter> {
  const { clientId, chapterId, ctx, voiceSamples } = args;
  const generate = args.deps?.generate ?? (async (s: string, u: string) => {
    const { content, finishReason } = await callAIExtractionWithMeta(s, u, MODEL);
    // A truncated completion is an outage by definition: what came back is half
    // a chapter, and half a chapter can clear all four gates. `finish_reason`
    // is the only place that fact is stated, and the `callAIExtraction`
    // convenience wrapper throws it away.
    if (finishReason === "length") throw new Error("model output was truncated");
    return content;
  });
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
    // A hit with no chapter in it is not a hit. The same floor as the write
    // path, applied in both directions, so an entry left by an older deploy
    // heals on the next render instead of serving a stub for its 30-day TTL.
    // This is not re-validation: the gates are deliberately NOT re-run on a hit.
    //
    // `ai-cache.ts` casts whatever Redis returns to `AiCacheValue` with no shape
    // check, and this read sits outside the `try` — so dereferencing a missing
    // `markdown` would throw straight out of a function this file's header
    // documents as never throwing.
    const cachedMarkdown = hit?.markdown ?? "";
    if (hit && hasSubstance(cachedMarkdown)) {
      return {
        chapterId, markdown: cachedMarkdown, sourceHash, aiSuppressed: false,
        failures: [], error: null, generatedAt: hit.generatedAt, cached: true,
      };
    }
  }

  /**
   * The substance floor, applied to what the model returned. Thrown rather than
   * returned so one handler covers both attempts, and treated as an outage
   * rather than as a retry: a stub is a truncation or a content filter, and
   * neither is something a retry prompt can name.
   */
  const draft = async (prompt: { system: string; user: string }): Promise<string> => {
    const text = (await generate(prompt.system, prompt.user)).trim();
    if (!hasSubstance(text)) throw new ThinDraftError("model returned no usable chapter");
    return text;
  };

  // Held outside the `try` so a stub on the SECOND attempt does not unwind past
  // the findings the first one produced: those findings are what explain the
  // suppression to the advisor, and losing them leaves Regenerate as the only
  // move.
  let firstFailures: GateFailure[] = [];

  try {
    const attempt1 = await draft(first);
    let markdown = attempt1;
    firstFailures = runGates(attempt1, ctx.facts);

    if (firstFailures.length > 0) {
      const retry = buildChapterPrompt(chapterId, ctx, voiceSamples, retryNotes(firstFailures));
      const attempt2 = await draft(retry);
      const retryFailures = dedupe(runGates(attempt2, ctx.facts));
      if (retryFailures.length > 0) return fallback(retryFailures);
      markdown = attempt2;
    }

    const generatedAt = new Date().toISOString();
    // A cache write that fails must not cost the chapter we already hold: a miss
    // on the next run is cheap, suppressing a clean chapter is not. `try` rather
    // than `.catch` — an injected dependency can throw before it ever returns a
    // promise, and that shape walked straight into the outer handler, which
    // discarded a gate-clean chapter AND reported it to the advisor as an outage.
    try {
      await setCached(clientId, sourceHash, { markdown, generatedAt });
    } catch (err) {
      console.warn("[plan-story] cache write failed (non-fatal)", chapterId, err);
    }
    return {
      chapterId, markdown, sourceHash, aiSuppressed: false,
      failures: [], error: null, generatedAt, cached: false,
    };
  } catch (err) {
    // Non-fatal by design — mirrors ensure-ai-summaries.ts.
    console.error("[plan-story] generation failed (non-fatal)", chapterId, err);
    // A stub is not an outage: the assistant answered. Say so, and carry
    // whatever the first attempt was actually rejected for.
    if (err instanceof ThinDraftError) return fallback(dedupe(firstFailures), TOO_SHORT);
    return fallback([], UNAVAILABLE);
  }
}
