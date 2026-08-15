// Persistence for reviewed chapter text. Every entry point takes an already-
// authorized clientId — authorization itself belongs to the routes, per the
// project's authz/db-scoping split — so every statement here still scopes on
// clientId, and none of them can reach a row a bad id does not own.
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { planStoryChapters, type PlanStoryChapterRow } from "@/db/schema";
import type { ChapterId } from "./types";
import type { GeneratedChapter } from "./generate";

/**
 * Which register a chapter's words were written in. The same two values the
 * report's options carry, and since 0240 part of the storage key rather than a
 * property of the prose alone.
 */
export type DocumentRole = "standalone" | "frontMatter";

/**
 * Is this string one of them? Beside the type rather than in either route,
 * because BOTH plan-story GETs parse the same query parameter — and a third
 * register added to the type would otherwise have to be remembered in two
 * predicates. Miss one and the chapter list refuses a role the staleness check
 * accepts, so the panel lists rows it can never badge.
 */
export function isDocumentRole(value: string): value is DocumentRole {
  return value === "standalone" || value === "frontMatter";
}

/**
 * Words, or nothing — whitespace is not an edit and not a chapter.
 *
 * The ONE spelling of that rule. It decides what renders below AND whether
 * there is a rewrite to announce in `hasNewerGeneration`; two spellings of it
 * is how a chapter comes to be told it is shadowing a rewrite made of spaces.
 */
function words(text: string | null): string | null {
  return text != null && text.trim().length > 0 ? text : null;
}

/** Render precedence: the advisor's edit, then the model, then the
 *  deterministic narrative. A whitespace-only edit is not an edit. */
export function resolveChapterText(
  row: { editedText: string | null; generatedText: string | null },
  fallback: string,
): string {
  return words(row.editedText) ?? words(row.generatedText) ?? fallback;
}

/**
 * Is the model's stored version NEWER than the advisor's, and therefore stored
 * without being what prints?
 *
 * Confirmed live on a real household: press Regenerate on a chapter you have
 * edited and the new prose lands in `generatedText` while `editedText` keeps
 * winning at render time — so the advisor sees their own unchanged sentence,
 * which is exactly what that button's FAILURE message describes ("The words on
 * screen are unchanged — try again"). Nothing on screen can tell the two apart.
 *
 * The answer is not "prefer the newer text": that would overwrite an advisor's
 * writing without a click that says so. It is what the panel needs in order to
 * SAY what happened and offer the swap.
 *
 * ⚠️ Both timestamps are nullable, and a null is a REFUSAL to answer rather
 * than a zero. Every row written before 0242 carries null on BOTH sides, and a
 * row edited since but not regenerated carries one — either way the order is
 * unknowable. False is the only safe reading: a wrong TRUE puts "Use the new
 * version instead" in front of an advisor over prose that was never superseded.
 */
export function hasNewerGeneration(row: {
  editedText: string | null;
  generatedText: string | null;
  generatedAt: Date | null;
  editedAt: Date | null;
}): boolean {
  if (words(row.editedText) == null) return false;
  if (words(row.generatedText) == null) return false;
  if (row.editedAt == null || row.generatedAt == null) return false;
  // Strictly later. `updateChapterText` stamps `editedAt` and `updatedAt` from
  // one clock read, and a generation that reproduced the stored words does not
  // move `generatedAt` at all — so equal means the advisor's write is current.
  return row.generatedAt.getTime() > row.editedAt.getTime();
}

/** True when the plan has moved since this chapter was generated. Never true
 *  for a chapter that has not been generated at all. */
export function isChapterStale(row: { sourceHash: string | null }, currentHash: string): boolean {
  return row.sourceHash != null && row.sourceHash !== currentHash;
}

/**
 * The one row a chapter has, PER ROLE. Shared by all three writers so the key
 * they conflict on cannot drift from the unique index, or from each other.
 */
const CHAPTER_KEY = [
  planStoryChapters.clientId,
  planStoryChapters.scenarioId,
  planStoryChapters.documentRole,
  planStoryChapters.chapterId,
];

/**
 * True in SQL when the incoming write actually changes the chapter's words.
 * `is distinct from` rather than `<>` so a first generation over a null still
 * counts as a change.
 */
const TEXT_CHANGED = sql`${planStoryChapters.generatedText} is distinct from excluded.generated_text`;

/**
 * Keeps a column's stored value unless the words changed, in which case it is
 * cleared.
 *
 * Review is an assertion about specific sentences — "an advisor read THESE
 * words and approved them". Regeneration replaces the sentences, so an approval
 * that survived it would mark text nobody has read as reviewed, and both the
 * review panel's unreviewed count and the export gate read that flag.
 *
 * Conditional rather than an unconditional clear because the generate route
 * upserts on every run, including a cache hit that reproduces the stored
 * chapter byte for byte. Clearing there would un-review an approved chapter on
 * a page refresh, which makes the flag unreachable.
 */
function clearedWhenTextChanges(column: AnyPgColumn): SQL {
  return sql`case when ${TEXT_CHANGED} then null else ${column} end`;
}

/**
 * The mirror of the above: a column that RECORDS the moment the words changed,
 * and holds still when they did not.
 *
 * Same condition, same reason. `generatedAt` is what `hasNewerGeneration` reads
 * as "when the model wrote", and the generate route upserts on every run
 * including a cache hit reproducing the stored chapter word for word — so an
 * unconditional stamp would tell an advisor who edited a chapter and then
 * pressed Generate all that the assistant had rewritten it behind them, and
 * offer to replace their writing with the very prose they had replaced.
 *
 * ⚠️ `toISOString()`, not the `Date`. Drizzle maps a `timestamp` column's Date
 * through `mapToDriverValue` (UTC), but a raw `sql` fragment has no column type
 * to map through — node-postgres would serialize the Date in LOCAL time with an
 * offset, and `timestamp without time zone` truncates the offset, storing the
 * wall clock of whatever region the server is in. `editedAt` goes through the
 * column, so the two would be hours apart and the comparison meaningless.
 */
function stampedWhenTextChanges(column: AnyPgColumn, at: Date): SQL {
  return sql`case when ${TEXT_CHANGED} then ${at.toISOString()}::timestamp else ${column} end`;
}

export async function listStoryChapters(
  clientId: string,
  scenarioId: string,
  documentRole: DocumentRole,
): Promise<PlanStoryChapterRow[]> {
  return db
    .select()
    .from(planStoryChapters)
    .where(
      and(
        eq(planStoryChapters.clientId, clientId),
        eq(planStoryChapters.scenarioId, scenarioId),
        eq(planStoryChapters.documentRole, documentRole),
      ),
    );
}

/**
 * Store a fresh generation. The advisor's `editedText` is deliberately NOT
 * cleared — silently discarding an advisor's writing because a projection moved
 * would be the worst failure mode this feature has.
 *
 * Which leaves the model's new words stored and not printing, and that state
 * has to be VISIBLE rather than merely safe: `generatedAt` below is what
 * `hasNewerGeneration` reads to tell the panel to say so and offer the swap.
 * Before it existed the rewrite was stored, invisible, and indistinguishable
 * from the button having failed.
 */
export async function upsertGeneratedChapter(args: {
  clientId: string;
  scenarioId: string;
  /** Required on all three writers, never defaulted — a default here is
   *  indistinguishable from the bug the column was added to fix. */
  documentRole: DocumentRole;
  chapter: GeneratedChapter;
  /**
   * Whose voice these words are in — the acting advisor's Clerk user id.
   *
   * ⚠️ Required, and it travels with `sourceHash` rather than beside it: the
   * hash is BUILT from this advisor's voice, and the freshness check has to
   * rebuild it from the same one. A row that cannot say who wrote it can only
   * be rebuilt in the reader's voice, which answers a different question.
   */
  generatedByUserId: string;
}): Promise<void> {
  const { clientId, scenarioId, documentRole, chapter, generatedByUserId } = args;
  const now = new Date();
  await db
    .insert(planStoryChapters)
    .values({
      clientId,
      scenarioId,
      documentRole,
      chapterId: chapter.chapterId,
      generatedText: chapter.markdown,
      generatedAt: now,
      generatedByUserId,
      sourceHash: chapter.sourceHash,
      aiSuppressed: chapter.aiSuppressed,
      error: chapter.error,
    })
    .onConflictDoUpdate({
      target: CHAPTER_KEY,
      set: {
        generatedText: chapter.markdown,
        // Only when the words really moved — see `stampedWhenTextChanges`.
        generatedAt: stampedWhenTextChanges(planStoryChapters.generatedAt, now),
        // …and this one on EVERY run, exactly as `sourceHash` below is: the two
        // are the answer and the question. This run's hash was built from THIS
        // advisor's voice whether or not the model produced new words, and a
        // stamp that disagreed with the hash beside it would send the freshness
        // check to the wrong voice.
        generatedByUserId,
        sourceHash: chapter.sourceHash,
        aiSuppressed: chapter.aiSuppressed,
        // Written on every run, null included: a stored outage that outlives
        // the outage tells the advisor the assistant is still down.
        error: chapter.error,
        reviewedAt: clearedWhenTextChanges(planStoryChapters.reviewedAt),
        reviewedByUserId: clearedWhenTextChanges(planStoryChapters.reviewedByUserId),
        updatedAt: now,
      },
    });
}

/**
 * Save the advisor's version — creating the row if the chapter has never been
 * generated.
 *
 * An upsert rather than a bare UPDATE because a chapter with no row is a state
 * the panel actively offers: the story lists every chapter whether one has been
 * generated or not, so "write this one yourself" is a first-class path, not an
 * edge case. An UPDATE there matches nothing, reports nothing, and the advisor's
 * writing is gone — the failure the comment above calls the worst this feature
 * has. Making the operation total also means a route can never audit a write
 * that did not land: this either stores the text or throws.
 *
 * `generatedText` is untouched, so the model's version stays available to
 * revert to, and a row created here simply has none yet.
 */
export async function updateChapterText(args: {
  clientId: string;
  scenarioId: string;
  documentRole: DocumentRole;
  chapterId: ChapterId;
  editedText: string;
}): Promise<void> {
  // ⚠️ ONE clock read, shared by both stamps and both paths.
  // `hasNewerGeneration` asks whether the model's stamp is STRICTLY later than
  // this one; two `new Date()` calls a millisecond apart would let an ordinary
  // save read as a rewrite that shadowed it.
  const now = new Date();
  await db
    .insert(planStoryChapters)
    .values({
      clientId: args.clientId,
      scenarioId: args.scenarioId,
      documentRole: args.documentRole,
      chapterId: args.chapterId,
      editedText: args.editedText,
      editedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: CHAPTER_KEY,
      set: { editedText: args.editedText, editedAt: now, updatedAt: now },
    });
}

/**
 * Record that an advisor has read this chapter and stands behind it — creating
 * the row if there isn't one.
 *
 * A row created here carries no `generatedText`, and that is meaningful rather
 * than empty: with nothing generated, `resolveChapterText` renders the
 * deterministic narrative, so the advisor is approving the words the client will
 * actually read. `isChapterStale` already reports such a row fresh. Without the
 * insert this call is a silent no-op, and a chapter nobody ever generated stays
 * in the unreviewed count permanently — an export gate reading that count could
 * never be cleared.
 *
 * A later generation un-reviews it: the stored null is `distinct from` the
 * model's text, which is the right answer, because the approved words were the
 * deterministic ones.
 */
export async function markChapterReviewed(args: {
  clientId: string;
  scenarioId: string;
  documentRole: DocumentRole;
  chapterId: ChapterId;
  userId: string;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(planStoryChapters)
    .values({
      clientId: args.clientId,
      scenarioId: args.scenarioId,
      documentRole: args.documentRole,
      chapterId: args.chapterId,
      reviewedAt: now,
      reviewedByUserId: args.userId,
    })
    .onConflictDoUpdate({
      target: CHAPTER_KEY,
      set: { reviewedAt: now, reviewedByUserId: args.userId, updatedAt: now },
    });
}
