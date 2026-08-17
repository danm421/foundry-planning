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
// Nor is every INPUT to it. The advisor's per-chapter tone and length are hash
// inputs that travel on the request rather than off this load — see the note on
// `voice` below — so "one run's inputs" means the ones a load can answer.
//
// (`route.ts` may export nothing but handlers, so a shared helper for two routes
// lives here rather than beside either of them.)
import { storyCandidates } from "./chapters/registry";
import { loadStoryContext } from "./load-context";
import type { DocumentRole } from "./repo";
import type { ChapterId, StoryContext } from "./types";
import { loadVoiceProfile, listVoiceSamples } from "./voice/repo";
import { resolveVoice, type StoryVoice } from "./voice/resolve";

export interface StoryRun {
  ctx: StoryContext;
  /**
   * The chapters this run COULD narrate, so the loader can skip the solves
   * behind facts nothing will read. On a base-only run that is both max-spend
   * solves, since the chapter reading them requires a proposal.
   *
   * `storyCandidates` in `chapters/registry.ts` — the same answer the generate
   * route and the chapter list ask for, not a copy of it.
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
   * The advisor's voice — a style note and up to four scrubbed exemplars.
   *
   * ⚠️ AN INPUT TO THE HASH (`chapterSourceHash`). The generating side and the
   * staleness side must be handed the identical object, which is what reading it
   * off the run makes automatic. It is no longer the documented empty literal it
   * was through Plans 1 and 2.
   *
   * ⚠️ WHOSE voice is the caller's business, not this object's — see
   * `advisorUserId` below. The staleness route asks for the run in the caller's
   * voice and then resolves a SECOND one per generating advisor through
   * `loadAdvisorVoice`, because a report can hold chapters written by two
   * people.
   *
   * ⚠️ …but no longer the ONLY input this run has to supply. The per-chapter
   * tone and length are hash inputs too, and they are deliberately NOT here:
   * they are per-CHAPTER and travel on the request, so there is nothing for a
   * run-level field to hold. Both routes resolve them through
   * `resolveChapterStyles` (`./types.ts`) instead — one spelling, two
   * transports. Don't go looking for style on this object.
   */
  voice: StoryVoice;
}

/**
 * One advisor's voice, resolved. Two reads and the rule that combines them.
 *
 * Exported and used BY `loadStoryRun` below rather than sitting beside it,
 * because the staleness route needs a voice for an advisor who is not the
 * caller — the one who actually generated a chapter — and cannot afford a
 * second whole run to get it. One spelling, so the voice a chapter is hashed
 * against cannot differ from the voice a chapter was written in by so much as a
 * disabled sample; two derivations that drifted would report every chapter of
 * every report out of date, permanently, with nothing able to clear it.
 */
export async function loadAdvisorVoice(
  firmId: string,
  advisorUserId: string,
): Promise<StoryVoice> {
  const [profile, samples] = await Promise.all([
    loadVoiceProfile(firmId, advisorUserId),
    listVoiceSamples(firmId, advisorUserId),
  ]);
  return resolveVoice(profile, samples);
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
  /**
   * Whose voice. A Clerk user id — `loadVoiceProfile` falls back to the firm's
   * row when this advisor has none.
   *
   * ⚠️ THE CALLER's voice — not necessarily the voice a chapter already in
   * storage was written in. The two coincide only for a caller about to WRITE
   * fresh prose: this advisor's voice is what the new words go in, and it is
   * stamped on the row as `generatedByUserId` so a later reader can tell whose
   * voice it was.
   *
   * A caller instead COMPARING this run against an existing row must not
   * assume the two coincide — it has to read that row's own stamp and rebuild
   * THAT chapter's hash through `loadAdvisorVoice` for whoever actually wrote
   * it, falling back to this parameter only on a row written before the stamp
   * existed. Firm-wide voice rows are shared and cost nothing extra there; a
   * PERSONAL note or sample is what makes two people at one firm disagree.
   *
   * A caller whose question never touches voice at all — nothing in
   * `ctx.facts` reads it — may pass any value that names a real advisor: this
   * parameter is required because `loadStoryRun` always resolves one, not
   * because every caller's answer depends on what it resolves to.
   */
  advisorUserId: string;
  /** Already resolved by `resolveStoryScenarioId` — "base" or a real id. */
  scenarioId: string;
  documentRole: DocumentRole;
}): Promise<StoryRun> {
  const proposedRef = args.scenarioId === "base" ? null : args.scenarioId;
  const candidates = storyCandidates(args.scenarioId);
  const [ctx, voice] = await Promise.all([
    loadStoryContext({
      clientId: args.clientId,
      firmId: args.firmId,
      proposedRef,
      scenarioLabel: proposedRef ? "the proposed plan" : "Base Case",
      documentRole: args.documentRole,
      chapters: candidates,
    }),
    loadAdvisorVoice(args.firmId, args.advisorUserId),
  ]);
  return { ctx, candidates, voice };
}
