// Every input ONE generation run is written from, in one object.
//
// Two routes need the identical answer and must not derive it twice: the
// generate route writes each chapter's `sourceHash` from this context, and the
// staleness route compares the stored hash against this context rebuilt. Any
// difference between the two — a scenario label, a solve that one of them
// skipped, a voice sample one of them had — changes the prompt, changes the
// hash, and reports every chapter on the report as out of date. It cannot be two
// copies of the same six lines.
//
// The hash itself is NOT here: it is `chapterSourceHash` in `chapters/prompts.ts`,
// so that `generate.ts` calls the same function rather than a matching one.
//
// (`route.ts` may export nothing but handlers, so a shared helper for two routes
// lives here rather than beside either of them.)
import { CHAPTERS } from "./chapters/registry";
import { loadStoryContext } from "./load-context";
import type { DocumentRole } from "./repo";
import { CHAPTER_IDS, type ChapterId, type StoryContext } from "./types";

export interface StoryRun {
  ctx: StoryContext;
  /**
   * The chapters this run COULD narrate, so the loader can skip the solves
   * behind facts nothing will read. On a base-only run that is both max-spend
   * solves, since the chapter reading them requires a proposal.
   *
   * ⚠️ NOT the list the generate route finally writes: that one also reads
   * `available` and `hasSomethingToPropose`, both derived from `ctx`, which is
   * what this load RETURNS. So the list going IN is derived from the ref alone,
   * which is everything known before the facts exist.
   *
   * Deliberately looser as a result — a proposal carrying no changes still
   * solves its max spend. That is the correct direction to be wrong in: the
   * list must be a SUPERSET of what gets narrated, or a chapter is written from
   * a pack missing its own facts and prints an honest empty state on a document
   * handed to a client.
   */
  candidates: ChapterId[];
  /**
   * Samples of the advisor's own writing the model is asked to match.
   *
   * ⚠️ Empty today — nothing in the app collects them yet — and carried here
   * anyway because they are an INPUT TO THE HASH (`chapterSourceHash`). The day
   * they are real, the generating side and the staleness side have to be handed
   * the same ones; reading them off the run is what makes that automatic
   * instead of two literals that have to be remembered together.
   */
  voiceSamples: string[];
}

/**
 * `StoryRun.candidates`, derived from the ref ALONE — so it costs nothing and
 * can be asked before the load. Read that field's invariant before using it: it
 * is a SUPERSET of what finally gets narrated, never the list itself.
 *
 * Exported so a caller can refuse an impossible request without paying for the
 * context first, and still be reading the same derivation the load uses.
 */
export function storyCandidates(scenarioId: string): ChapterId[] {
  const hasProposedRef = scenarioId !== "base";
  return CHAPTER_IDS.filter((c) => hasProposedRef || !CHAPTERS[c].requiresProposal);
}

/**
 * ⚠️ EXPENSIVE. Two projections, a Monte Carlo read, a balance sheet and (on a
 * proposal) two solves. MEASURED 2026-08-14 on a 21-account household with no
 * proposal: 23.2s cold, 4.0s warm. Nothing on a per-keystroke path may call it —
 * which is why the staleness flag is its own endpoint rather than a field on the
 * chapter list the panel reloads after every save.
 */
export async function loadStoryRun(args: {
  clientId: string;
  firmId: string;
  /** Already resolved by `resolveStoryScenarioId` — "base" or a real id. */
  scenarioId: string;
  documentRole: DocumentRole;
}): Promise<StoryRun> {
  const proposedRef = args.scenarioId === "base" ? null : args.scenarioId;
  const candidates = storyCandidates(args.scenarioId);
  const ctx = await loadStoryContext({
    clientId: args.clientId,
    firmId: args.firmId,
    proposedRef,
    scenarioLabel: proposedRef ? "the proposed plan" : "Base Case",
    documentRole: args.documentRole,
    chapters: candidates,
  });
  return { ctx, candidates, voiceSamples: [] };
}
