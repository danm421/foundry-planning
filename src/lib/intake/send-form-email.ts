import { currentUser } from "@clerk/nextjs/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { intakeEmailSettings } from "@/db/schema";
import { getAdvisorProfile } from "@/lib/branding/advisor-profile";
import { resolveFirmName } from "@/lib/activity/resolve-firm-names";
import { sendIntakeFormEmail, type IntakeEmailResult } from "@/lib/intake/email";
import { resolveSubject } from "@/lib/intake/email-template";

/**
 * Compose and send "here is your form" to a recipient.
 *
 * Shared by the two surfaces that mail an intake link: the first send
 * (POST /api/data-collection) and the reminder (POST /api/data-collection/
 * [id]/remind). One composer on purpose — a reminder that resolved its brand,
 * saved copy or signature differently from the original would reach the client
 * looking like mail from someone else.
 */
export async function sendIntakeLinkEmail(args: {
  firmId: string;
  /** The advisor sending right now: their saved copy and their signature. */
  senderUserId: string;
  /**
   * The household's OWN advisor, whose brand the recipient should see. A send
   * with no client behind it passes the sender.
   */
  brandAdvisorUserId: string;
  to: string;
  link: string;
  clientName?: string | null;
  /** Marks the subject as a nudge rather than a first send. */
  reminder?: boolean;
}): Promise<IntakeEmailResult> {
  const { firmId, senderUserId, brandAdvisorUserId, to, link, clientName } = args;

  // Four round-trips — two Clerk, two DB — and none reads another's result, so
  // they overlap rather than queue. Both callers pay this, and the send route
  // pays it while an advisor waits on a button.
  //
  // `currentUser()` is the ambient request session, which is the same person as
  // `senderUserId` at both call sites today. A caller with no session (an
  // auto-nudge cron) would need `users.getUser(senderUserId)` instead.
  const [firmName, advisor, settingsRows, advisorProfile] = await Promise.all([
    resolveFirmName(firmId),
    currentUser(),
    db
      .select()
      .from(intakeEmailSettings)
      .where(
        and(
          eq(intakeEmailSettings.firmId, firmId),
          eq(intakeEmailSettings.userId, senderUserId),
        ),
      ),
    getAdvisorProfile(firmId, brandAdvisorUserId),
  ]);

  const advisorName =
    [advisor?.firstName, advisor?.lastName].filter(Boolean).join(" ") || undefined;
  const advisorEmail = advisor?.primaryEmailAddress?.emailAddress ?? undefined;
  const settings = settingsRows[0];

  // Per-field fall-through, brand wins: a blank/unset brand field must never
  // clobber a working intake_email_settings value, so trim-then-truthy rather
  // than `??` (a stored "" would otherwise win).
  const brandFromName = advisorProfile?.brandingEnabled
    ? advisorProfile.emailFromName?.trim() || undefined
    : undefined;
  const brandReplyTo = advisorProfile?.brandingEnabled
    ? advisorProfile.emailReplyTo?.trim() || undefined
    : undefined;

  // Resolved first, then prefixed: the advisor's saved subject is optional, and
  // a nudge that arrived byte-identical to the first mail reads as a glitch.
  const subject = args.reminder
    ? `Reminder: ${resolveSubject(settings?.subject ?? undefined)}`
    : (settings?.subject ?? undefined);

  return sendIntakeFormEmail({
    to,
    link,
    fromName: brandFromName ?? settings?.fromName ?? undefined,
    replyTo: brandReplyTo,
    subject,
    introBody: settings?.introBody ?? undefined,
    advisorName,
    advisorEmail,
    firmName,
    clientName: clientName ?? undefined,
  });
}
