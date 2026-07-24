import { cache } from "react";
import { db } from "@/db";
import { advisorProfiles, type AdvisorProfileRow } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export type BrandFields = Pick<
  AdvisorProfileRow,
  | "brandName" | "logoUrl" | "faviconUrl" | "primaryColor"
  | "contactEmail" | "contactPhone" | "website" | "address"
  | "emailFromName" | "emailReplyTo"
>;

/**
 * React-`cache`d per request. Within a single request, a read that follows a
 * write to the same (firmId, advisorUserId) — e.g. via `upsertAdvisorProfile`
 * or `setAdvisorBrandingEnabled` — returns the memoized pre-write row, not
 * the fresh one. Callers that need post-write state should use
 * `upsertAdvisorProfile`'s return value (the row from `.returning()`)
 * instead of re-calling this getter.
 */
export const getAdvisorProfile = cache(
  async (firmId: string, advisorUserId: string): Promise<AdvisorProfileRow | null> => {
    const row = await db.query.advisorProfiles.findFirst({
      where: and(
        eq(advisorProfiles.firmId, firmId),
        eq(advisorProfiles.advisorUserId, advisorUserId),
      ),
    });
    return row ?? null;
  },
);

/**
 * Every advisor profile in one firm, in a single firm-scoped query. The
 * admin grant list joins this with `listFirmMembers` rather than calling
 * `getAdvisorProfile` per member (N+1).
 *
 * Advisors with no row yet are simply absent — the row is created lazily by
 * the first upsert, so callers must render a missing advisor as "off" rather
 * than omitting them.
 */
export async function listAdvisorProfiles(
  firmId: string,
): Promise<AdvisorProfileRow[]> {
  return db
    .select()
    .from(advisorProfiles)
    .where(eq(advisorProfiles.firmId, firmId));
}

export async function upsertAdvisorProfile(
  firmId: string,
  advisorUserId: string,
  fields: Partial<BrandFields>,
  updatedBy: string,
): Promise<AdvisorProfileRow> {
  const [row] = await db
    .insert(advisorProfiles)
    .values({ firmId, advisorUserId, updatedBy, ...fields })
    .onConflictDoUpdate({
      target: [advisorProfiles.firmId, advisorProfiles.advisorUserId],
      set: { ...fields, updatedBy, updatedAt: new Date() },
    })
    .returning();
  return row;
}

export async function setAdvisorBrandingEnabled(
  firmId: string,
  advisorUserId: string,
  enabled: boolean,
  updatedBy: string,
): Promise<void> {
  await db
    .insert(advisorProfiles)
    .values({ firmId, advisorUserId, brandingEnabled: enabled, updatedBy })
    .onConflictDoUpdate({
      target: [advisorProfiles.firmId, advisorProfiles.advisorUserId],
      set: { brandingEnabled: enabled, updatedBy, updatedAt: new Date() },
    });
}
