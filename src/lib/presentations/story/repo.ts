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

/** One chapter, scoped. The three predicates every statement below shares. */
function chapterScope(clientId: string, scenarioId: string, chapterId: ChapterId) {
  return and(
    eq(planStoryChapters.clientId, clientId),
    eq(planStoryChapters.scenarioId, scenarioId),
    eq(planStoryChapters.chapterId, chapterId),
  );
}

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
      target: [planStoryChapters.clientId, planStoryChapters.scenarioId, planStoryChapters.chapterId],
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

export async function updateChapterText(args: {
  clientId: string;
  scenarioId: string;
  chapterId: ChapterId;
  editedText: string;
}): Promise<void> {
  await db
    .update(planStoryChapters)
    .set({ editedText: args.editedText, updatedAt: new Date() })
    .where(chapterScope(args.clientId, args.scenarioId, args.chapterId));
}

export async function markChapterReviewed(args: {
  clientId: string;
  scenarioId: string;
  chapterId: ChapterId;
  userId: string;
}): Promise<void> {
  await db
    .update(planStoryChapters)
    .set({ reviewedAt: new Date(), reviewedByUserId: args.userId, updatedAt: new Date() })
    .where(chapterScope(args.clientId, args.scenarioId, args.chapterId));
}
