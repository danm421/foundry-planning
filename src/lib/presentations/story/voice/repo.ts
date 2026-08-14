// Persistence for the voice profile and its exemplars. Every entry point takes
// an already-authorized firmId — authorization belongs to the routes, per the
// project's authz/db-scoping split — so every statement here still scopes on
// firmId, and none of them can reach a row a bad id does not own.
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { storyVoiceProfiles, storyVoiceSamples, type StoryVoiceSampleRow } from "@/db/schema";

/** "" is the firm default — NOT null. See the schema note. */
export const FIRM_DEFAULT_ADVISOR = "";

export interface VoiceProfile {
  firmId: string;
  advisorUserId: string;
  styleNote: string;
}

/**
 * The profile that applies to this advisor: their own row if they have one, the
 * firm's if they don't, null if neither exists.
 *
 * Two rows read in one query rather than two round trips, and resolved in JS —
 * the precedence is the interesting part and belongs where it can be tested
 * without a database.
 */
export async function loadVoiceProfile(
  firmId: string,
  advisorUserId: string,
): Promise<VoiceProfile | null> {
  const rows = await db
    .select()
    .from(storyVoiceProfiles)
    .where(eq(storyVoiceProfiles.firmId, firmId));
  const mine = rows.find((r) => r.advisorUserId === advisorUserId);
  const firm = rows.find((r) => r.advisorUserId === FIRM_DEFAULT_ADVISOR);
  const row = mine ?? firm;
  return row ? { firmId: row.firmId, advisorUserId: row.advisorUserId, styleNote: row.styleNote } : null;
}

export async function upsertVoiceProfile(args: {
  firmId: string;
  advisorUserId: string;
  styleNote: string;
  updatedBy: string;
}): Promise<void> {
  await db
    .insert(storyVoiceProfiles)
    .values({
      firmId: args.firmId,
      advisorUserId: args.advisorUserId,
      styleNote: args.styleNote,
      updatedBy: args.updatedBy,
    })
    .onConflictDoUpdate({
      target: [storyVoiceProfiles.firmId, storyVoiceProfiles.advisorUserId],
      set: { styleNote: args.styleNote, updatedBy: args.updatedBy, updatedAt: new Date() },
    });
}

/**
 * Every sample that applies to this advisor — their own AND the firm's, newest
 * first. Both, not one or the other: a firm sample is a house style an advisor
 * adds their own voice on top of, which is not the precedence the PROFILE has.
 *
 * ⚠️ The order is load-bearing, not presentational: `resolveVoice` keeps the
 * FIRST FOUR of what this returns and they go into `chapterSourceHash`. So the
 * id is a second sort key — two rows written in one transaction share
 * `defaultNow()` to the microsecond, and Postgres is free to return a tie in any
 * order it likes, which would move a sample in and out of the four and change
 * every chapter's stored hash. The id is a v4 uuid and carries NO time: it is
 * here for DETERMINISM, and any stable key would do.
 */
export async function listVoiceSamples(
  firmId: string,
  advisorUserId: string,
): Promise<StoryVoiceSampleRow[]> {
  const rows = await db
    .select()
    .from(storyVoiceSamples)
    .where(eq(storyVoiceSamples.firmId, firmId))
    .orderBy(desc(storyVoiceSamples.createdAt), desc(storyVoiceSamples.id));
  return rows.filter(
    (r) => r.advisorUserId === advisorUserId || r.advisorUserId === FIRM_DEFAULT_ADVISOR,
  );
}

export async function insertVoiceSample(args: {
  firmId: string;
  advisorUserId: string;
  text: string;
  sourceChapterId: string | null;
  sourceClientId: string | null;
  createdBy: string;
}): Promise<string> {
  const [row] = await db
    .insert(storyVoiceSamples)
    .values({ ...args, enabled: false })
    .returning({ id: storyVoiceSamples.id });
  return row.id;
}

/** False when no row matched — which is how a route tells "another firm's id"
 *  from "done", without ever reading the row first. */
export async function setVoiceSampleEnabled(args: {
  firmId: string;
  id: string;
  enabled: boolean;
}): Promise<boolean> {
  const updated = await db
    .update(storyVoiceSamples)
    .set({ enabled: args.enabled, updatedAt: new Date() })
    .where(and(eq(storyVoiceSamples.id, args.id), eq(storyVoiceSamples.firmId, args.firmId)))
    .returning({ id: storyVoiceSamples.id });
  return updated.length > 0;
}

export async function deleteVoiceSample(args: { firmId: string; id: string }): Promise<boolean> {
  const deleted = await db
    .delete(storyVoiceSamples)
    .where(and(eq(storyVoiceSamples.id, args.id), eq(storyVoiceSamples.firmId, args.firmId)))
    .returning({ id: storyVoiceSamples.id });
  return deleted.length > 0;
}
