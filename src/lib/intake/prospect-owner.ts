import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { advisorProfiles } from "@/db/schema";
import { brandAdvisorOf } from "@/lib/branding/brand-choice";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Who owns the household a prospect form creates. A send made under another
 * advisor's brand was made on their behalf, so the household is theirs while
 * their branding is still on — the Clerk membership webhook turns it off when
 * they leave the firm. Anything else (the firm brand, the sender's own, a form
 * from before the brand picker, branding since turned off) stays with the
 * sender, as it always did.
 */
export async function prospectHouseholdOwner(
  tx: Tx,
  form: { firmId: string; brand: string | null; createdByUserId: string },
): Promise<string> {
  const advisorId = form.brand ? brandAdvisorOf(form.brand) : null;
  if (!advisorId || advisorId === form.createdByUserId) return form.createdByUserId;
  const [profile] = await tx
    .select({ brandingEnabled: advisorProfiles.brandingEnabled })
    .from(advisorProfiles)
    .where(and(eq(advisorProfiles.firmId, form.firmId), eq(advisorProfiles.advisorUserId, advisorId)))
    .limit(1);
  return profile?.brandingEnabled ? advisorId : form.createdByUserId;
}
