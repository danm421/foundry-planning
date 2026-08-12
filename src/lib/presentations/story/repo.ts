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

/** Render precedence: the advisor's edit, then the model, then the
 *  deterministic narrative. A whitespace-only edit is not an edit. */
export function resolveChapterText(
  row: { editedText: string | null; generatedText: string | null },
  fallback: string,
): string {
  if (row.editedText && row.editedText.trim().length > 0) return row.editedText;
  if (row.generatedText && row.generatedText.trim().length > 0) return row.generatedText;
  return fallback;
}

/** True when the plan has moved since this chapter was generated. Never true
 *  for a chapter that has not been generated at all. */
export function isChapterStale(row: { sourceHash: string | null }, currentHash: string): boolean {
  return row.sourceHash != null && row.sourceHash !== currentHash;
}

/**
 * The one row a chapter has. Shared by all three writers so the key they
 * conflict on cannot drift from the unique index, or from each other.
 */
const CHAPTER_KEY = [
  planStoryChapters.clientId,
  planStoryChapters.scenarioId,
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

export async function listStoryChapters(
  clientId: string,
  scenarioId: string,
): Promise<PlanStoryChapterRow[]> {
  return db
    .select()
    .from(planStoryChapters)
    .where(
      and(
        eq(planStoryChapters.clientId, clientId),
        eq(planStoryChapters.scenarioId, scenarioId),
      ),
    );
}

/**
 * Store a fresh generation. The advisor's `editedText` is deliberately NOT
 * cleared — the panel shows it as stale and lets them re-accept. Silently
 * discarding an advisor's writing because a projection moved would be the
 * worst failure mode this feature has.
 */
export async function upsertGeneratedChapter(args: {
  clientId: string;
  scenarioId: string;
  chapter: GeneratedChapter;
}): Promise<void> {
  const { clientId, scenarioId, chapter } = args;
  await db
    .insert(planStoryChapters)
    .values({
      clientId,
      scenarioId,
      chapterId: chapter.chapterId,
      generatedText: chapter.markdown,
      sourceHash: chapter.sourceHash,
      aiSuppressed: chapter.aiSuppressed,
      error: chapter.error,
    })
    .onConflictDoUpdate({
      target: CHAPTER_KEY,
      set: {
        generatedText: chapter.markdown,
        sourceHash: chapter.sourceHash,
        aiSuppressed: chapter.aiSuppressed,
        // Written on every run, null included: a stored outage that outlives
        // the outage tells the advisor the assistant is still down.
        error: chapter.error,
        reviewedAt: clearedWhenTextChanges(planStoryChapters.reviewedAt),
        reviewedByUserId: clearedWhenTextChanges(planStoryChapters.reviewedByUserId),
        updatedAt: new Date(),
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
  chapterId: ChapterId;
  editedText: string;
}): Promise<void> {
  await db
    .insert(planStoryChapters)
    .values({
      clientId: args.clientId,
      scenarioId: args.scenarioId,
      chapterId: args.chapterId,
      editedText: args.editedText,
    })
    .onConflictDoUpdate({
      target: CHAPTER_KEY,
      set: { editedText: args.editedText, updatedAt: new Date() },
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
  chapterId: ChapterId;
  userId: string;
}): Promise<void> {
  const now = new Date();
  await db
    .insert(planStoryChapters)
    .values({
      clientId: args.clientId,
      scenarioId: args.scenarioId,
      chapterId: args.chapterId,
      reviewedAt: now,
      reviewedByUserId: args.userId,
    })
    .onConflictDoUpdate({
      target: CHAPTER_KEY,
      set: { reviewedAt: now, reviewedByUserId: args.userId, updatedAt: now },
    });
}
