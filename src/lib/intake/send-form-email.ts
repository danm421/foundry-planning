import { currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { intakeEmailSettings } from "@/db/schema";
import { getAdvisorProfile } from "@/lib/branding/advisor-profile";
import { brandAdvisorOf, type BrandChoice } from "@/lib/branding/brand-choice";
import { listFirmMembers } from "@/lib/crm-tasks/members";
import { resolveFirmName } from "@/lib/activity/resolve-firm-names";
import { sendIntakeFormEmail, type IntakeEmailResult } from "@/lib/intake/email";
import { resolveSubject } from "@/lib/intake/email-template";
import { DEFAULT_INTAKE_REOPENED_INTRO } from "@/lib/intake/defaults";

// The reopened intro replaces the advisor's saved one, which is first-send copy
// ("takes about 10–15 minutes") — wrong for a client only adding to a form.
const FOLLOW_UP: Record<"reminder" | "reopened", { prefix: string; intro?: string }> = {
  reminder: { prefix: "Reminder" },
  reopened: { prefix: "Reopened", intro: DEFAULT_INTAKE_REOPENED_INTRO },
};

/**
 * Compose and send "here is your form" to a recipient.
 *
 * Shared by the two surfaces that mail an intake link: the first send
 * (POST /api/data-collection) and the reminder (POST /api/data-collection/
 * [id]/remind). One composer on purpose — a reminder that resolved its brand,
 * saved copy or signature differently from the original would reach the client
 * looking like mail from someone else. The household's advisor no longer owns
 * the brand: the form's `brand` decides who speaks.
 */
export async function sendIntakeLinkEmail(args: {
  firmId: string;
  /** The person clicking Send — who signs when no advisor brand is in effect. */
  senderUserId: string;
  /**
   * The form's brand. An advisor brand that is on, for an advisor still in
   * the firm, speaks as that advisor: their saved wording, their signature,
   * their brand name. Anything else — the firm brand, a brand turned off, an
   * advisor who has left — speaks as the sender, under the firm's name.
   */
  brand: BrandChoice;
  to: string;
  link: string;
  clientName?: string | null;
  /**
   * A mail about a form already out, rather than a first send: a nudge to
   * finish it, or word that a submitted form was sent back for more.
   */
  followUp?: keyof typeof FOLLOW_UP;
}): Promise<IntakeEmailResult> {
  const { firmId, senderUserId, to, link, clientName } = args;

  // Who signs is settled first, because it decides whose saved copy to read.
  // Clerk's member list is asked only when an advisor brand is actually on.
  const brandAdvisorId = brandAdvisorOf(args.brand);
  const profile = brandAdvisorId ? await getAdvisorProfile(firmId, brandAdvisorId) : null;
  const signer = profile?.brandingEnabled
    ? ((await listFirmMembers(firmId)).find((m) => m.userId === brandAdvisorId) ?? null)
    : null;
  const brandProfile = signer ? profile : null;

  // `currentUser()` is the ambient session — the sender at every call site
  // today. A caller with no session (an auto-nudge cron) would need
  // `users.getUser(senderUserId)` instead.
  const [firmName, sender, settingsRows] = await Promise.all([
    resolveFirmName(firmId),
    signer ? null : currentUser(),
    db
      .select()
      .from(intakeEmailSettings)
      .where(
        and(
          eq(intakeEmailSettings.firmId, firmId),
          eq(intakeEmailSettings.userId, signer?.userId ?? senderUserId),
        ),
      ),
  ]);

  const advisorName = signer
    ? signer.displayName
    : [sender?.firstName, sender?.lastName].filter(Boolean).join(" ") || undefined;
  const advisorEmail = signer
    ? (signer.email ?? undefined)
    : (sender?.primaryEmailAddress?.emailAddress ?? undefined);
  const settings = settingsRows[0];

  // Per-field fall-through, brand wins: a blank/unset brand field must never
  // clobber a working intake_email_settings value, so trim-then-truthy rather
  // than `??` (a stored "" would otherwise win).
  const brandFromName = brandProfile?.emailFromName?.trim() || undefined;
  const brandReplyTo = brandProfile?.emailReplyTo?.trim() || undefined;
  const brandName = brandProfile?.brandName?.trim() || undefined;

  // Resolved first, then prefixed: the saved subject is optional, and a
  // follow-up that arrived byte-identical to the first mail reads as a glitch.
  const followUp = args.followUp ? FOLLOW_UP[args.followUp] : undefined;
  const subject = followUp
    ? `${followUp.prefix}: ${resolveSubject(settings?.subject ?? undefined)}`
    : (settings?.subject ?? undefined);

  return sendIntakeFormEmail({
    to,
    link,
    fromName: brandFromName ?? settings?.fromName ?? undefined,
    replyTo: brandReplyTo,
    subject,
    introBody: followUp?.intro ?? settings?.introBody ?? undefined,
    advisorName,
    advisorEmail,
    firmName: brandName ?? firmName,
    clientName: clientName ?? undefined,
  });
}
