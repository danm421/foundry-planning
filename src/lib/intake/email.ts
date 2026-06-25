import { Resend } from "resend";
import {
  buildIntakeEmailHtml,
  buildIntakeFromHeader,
  resolveSubject,
} from "@/lib/intake/email-template";

/**
 * Send a client intake form invitation email via Resend. Best-effort: if
 * RESEND_API_KEY is unset, logs in development and returns silently. Errors
 * from Resend are caught and logged — this function never throws to its caller.
 */
export async function sendIntakeFormEmail(args: {
  to: string;
  link: string;
  fromName?: string;
  subject?: string;
  introBody?: string;
  advisorName?: string;
  advisorEmail?: string;
  firmName?: string;
  clientName?: string;
}): Promise<void> {
  const { to, link, fromName, subject, introBody, advisorName, advisorEmail, firmName, clientName } = args;

  const apiKey = process.env.RESEND_API_KEY;
  const from = buildIntakeFromHeader(fromName, firmName);

  if (!apiKey) {
    if (process.env.NODE_ENV === "development") {
      console.log("[intake-email] Resend not configured — skipping send", { to, link });
    }
    return;
  }

  try {
    const resend = new Resend(apiKey);
    const html = buildIntakeEmailHtml({ link, introBody, advisorName, advisorEmail, firmName, clientName });
    await resend.emails.send({
      from,
      to,
      subject: resolveSubject(subject),
      html,
    });
  } catch (err) {
    console.error(
      "[intake-email] Resend send failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
