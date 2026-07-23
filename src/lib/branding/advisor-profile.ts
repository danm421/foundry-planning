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
