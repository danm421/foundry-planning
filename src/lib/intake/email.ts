import { Resend } from "resend";
import {
  buildIntakeEmailHtml,
  buildIntakeFromHeader,
  resolveSubject,
} from "@/lib/intake/email-template";

export type IntakeEmailResult = {
  delivered: boolean;
  reason?: "unconfigured" | "send_failed";
};

/**
 * Send a client intake form invitation email via Resend. Never throws: a
 * missing RESEND_API_KEY or a Resend-side error comes back as
 * `{ delivered: false }` so a caller that needs to tell the advisor nothing
 * went out can say so. The first send ignores the result — the form row is the
 * primary artifact there and already exists — while the reminder reports it,
 * since a reminder that sent nothing has done nothing at all.
 */
export async function sendIntakeFormEmail(args: {
  to: string;
  link: string;
  fromName?: string;
  replyTo?: string;
  subject?: string;
  introBody?: string;
  advisorName?: string;
  advisorEmail?: string;
  firmName?: string;
  clientName?: string;
}): Promise<IntakeEmailResult> {
  const { to, link, fromName, replyTo, subject, introBody, advisorName, advisorEmail, firmName, clientName } = args;

  const apiKey = process.env.RESEND_API_KEY;
  const from = buildIntakeFromHeader(fromName, firmName);

  if (!apiKey) {
    if (process.env.NODE_ENV === "development") {
      console.log("[intake-email] Resend not configured — skipping send", { to, link });
    }
    return { delivered: false, reason: "unconfigured" };
  }

  try {
    const resend = new Resend(apiKey);
    const html = buildIntakeEmailHtml({ link, introBody, advisorName, advisorEmail, firmName, clientName });
    await resend.emails.send({
      from,
      to,
      subject: resolveSubject(subject),
      html,
      replyTo,
    });
    return { delivered: true };
  } catch (err) {
    console.error(
      "[intake-email] Resend send failed:",
      err instanceof Error ? err.message : err,
    );
    return { delivered: false, reason: "send_failed" };
  }
}
