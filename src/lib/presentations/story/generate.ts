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
import { factsForChapter, type ChapterId, type StoryContext } from "./types";

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

/** A name has to match as a WORD. "Alan" is a substring of "balance", and a
 *  floor that counts that is no floor at all. */
function mentionsName(text: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  return new RegExp(String.raw`(?<![\p{L}\p{N}])${escaped}(?![\p{L}\p{N}])`, "iu").test(text);
}

/**
 * Does this text name anything the request actually supplied — a figure from the
 * pack, one of the advisor's strategy labels, or one of the household's first
 * names?
 *
 * The cheapest available answer to the one question none of the four gates asks:
 * is this draft about the plan AT ALL. All four judge what prose says, so a
 * refusal ("I'm sorry, I can't help with that. As an AI language model…") and an
 * echo of an injected instruction clear every one of them — no figures, short
 * plain sentences, no advice verbs, none of the AI tells — and are then stored as
 * the client's chapter and written to a 30-day cache that cannot be deleted.
 *
 * Deliberately NOT a fifth gate and not a phrase blacklist. It asks nothing
 * about the words a draft uses, only whether any of the material we handed the
 * model survived into it.
 */
function namesSomethingSupplied(text: string, ctx: StoryContext): boolean {
  const hay = text.toLowerCase();
  if (ctx.facts.some((f) => hay.includes(f.display.toLowerCase()))) return true;
  if (ctx.strategies.some((s) => s.name.length > 0 && hay.includes(s.name.toLowerCase()))) return true;
  return ctx.household.firstNames
    .split(/\s+and\s+|[,&]/u)
    .map((name) => name.trim())
    .some((name) => name.length > 0 && mentionsName(text, name));
}

/** Thrown by the two floors — too little text, or text that is not about this
 *  plan — so the handler can tell either from an outage and keep the findings
 *  the first attempt already produced. */
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
  const { clientId, chapterId, voiceSamples } = args;
  /**
   * Scope the pack to this chapter ONCE, here, and let everything below read the
   * result: the prompt the model is shown, the gate that judges what it wrote,
   * and the deterministic narrative that runs when the model is off all take
   * their figures from this one object.
   *
   * Deliberately one derived context rather than a filter at each of those three
   * call sites. Gate 1 checks a figure's spelling and never its meaning, so the
   * shown set and the allowed set have to be the same set — show a figure the
   * gate will reject and the chapter spends its single retry on a word we handed
   * it. Three filters that agree today can be edited apart; one array cannot.
   */
  const ctx: StoryContext = { ...args.ctx, facts: factsForChapter(args.ctx.facts, chapterId) };
  const generate = args.deps?.generate ?? (async (s: string, u: string) => {
    const { content, finishReason } = await callAIExtractionWithMeta(s, u, MODEL);
    // A completion that did not finish is an outage by definition: what came
    // back is half a chapter, and half a chapter clears all four gates and the
    // substance floor alike. `finish_reason` is the only place that fact is
    // stated, and the `callAIExtraction` convenience wrapper throws it away.
    //
    // Both non-`stop` reasons matter, and the second is the one that bites.
    // `length` is a hard cut mid-sentence; `content_filter` returns real,
    // well-formed prose that stops early, so nothing downstream can see that it
    // is a fragment. This check carries the share of the work the substance
    // floor cannot: the floor is 3 words because the app's own narrators go
    // that low, which is far too low to recognise a truncated chapter.
    if (finishReason === "length" || finishReason === "content_filter") {
      throw new Error(`model completion did not finish (${finishReason})`);
    }
    return content;
  });
  const getCached = args.deps?.getCached ?? getCachedAnalysis;
  const setCached = args.deps?.setCached ?? setCachedAnalysis;

  const first = buildChapterPrompt(chapterId, ctx, voiceSamples, []);
  const sourceHash = hashAiRequest(first);

  const narrative = CHAPTERS[chapterId].narrate(ctx).join("\n\n");
  /**
   * Whether the "about this plan" floor applies at all — and it applies only
   * where this module's OWN narrator clears it.
   *
   * The same rule that pins `MIN_CHAPTER_WORDS`: a draft the app would publish
   * itself must never be thrown away. Three of the shipped narratives name
   * nothing supplied, because there is nothing to name — an empty pack ("Here's
   * where your plan stands today…"), no balance sheet, no proposal — and for
   * those chapters the prompt asks for prose "without any numbers at all". So the
   * floor is exactly as demanding as the fallback and no more, which is what
   * makes it impossible for the two to drift apart. `generate.test.ts` runs every
   * chapter × pack through it, as it does for the word floor.
   */
  const floorApplies = namesSomethingSupplied(narrative, ctx);
  const aboutThePlan = (text: string): boolean => !floorApplies || namesSomethingSupplied(text, ctx);

  const fallback = (failures: GateFailure[], error: string | null = null): GeneratedChapter => ({
    chapterId,
    markdown: narrative,
    sourceHash,
    aiSuppressed: true,
    failures,
    error,
    generatedAt: new Date().toISOString(),
    cached: false,
  });

  if (!args.force) {
    // `ai-cache.ts` casts whatever Redis returns to `AiCacheValue` without
    // checking its shape, so nothing guarantees `markdown` is even a string —
    // and a read that throws, from a rejecting dependency or from a `markdown`
    // of the wrong type, would come straight out of a function this file's
    // header documents as never throwing. A failed read is a miss: generation
    // follows, which is what a miss does anyway.
    try {
      const hit = await getCached(clientId, sourceHash);
      // A hit with no chapter in it is not a hit. The same floor as the write
      // path, applied in both directions, so an entry left by an older deploy
      // heals on the next render instead of serving a stub for its 30-day TTL.
      // Not re-validation: the gates are deliberately NOT re-run on a hit.
      const cachedMarkdown = typeof hit?.markdown === "string" ? hit.markdown : "";
      // Both floors, applied in both directions. A refusal that was cached before
      // this rule existed heals on the next render instead of being served for
      // its 30-day TTL — which matters more here than for a stub, because `force`
      // is the only other escape and no UI sends it.
      if (hit && hasSubstance(cachedMarkdown) && aboutThePlan(cachedMarkdown)) {
        return {
          chapterId, markdown: cachedMarkdown, sourceHash, aiSuppressed: false,
          failures: [], error: null, generatedAt: hit.generatedAt, cached: true,
        };
      }
    } catch (err) {
      console.warn("[plan-story] cache read failed (non-fatal)", chapterId, err);
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

    // Judged on the draft that is about to be PUBLISHED, not on each attempt, so
    // it can never pre-empt a gate finding: a draft that invents a figure and
    // quotes none of ours is a Gate 1 rejection with a retry the model can act
    // on, not a stub. Thrown for the same reason the word floor is — one handler
    // for both attempts, and a stub is not something a retry prompt can name.
    if (!aboutThePlan(markdown)) {
      throw new ThinDraftError("model returned a draft that is not about this plan");
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
