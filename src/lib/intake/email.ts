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
 * went out can say so. Every caller now reports it: the reminder fails the
 * request outright (a reminder that sent nothing has done nothing at all),
 * while the first send keeps the form row — the primary artifact, already
 * written — and returns `delivered: false` with a warning beside it.
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
    // resend.emails.send() resolves { data: null, error } for every non-2xx
    // response rather than throwing — the `error` check is the real net. The
    // catch below only ever sees a transport fault, which is the rarer half.
    const { error } = await resend.emails.send({
      from,
      to,
      subject: resolveSubject(subject),
      html,
      replyTo,
    });
    if (error) {
      console.error(
        "[intake-email] Resend rejected the send:",
        error.message ?? error,
      );
      return { delivered: false, reason: "send_failed" };
    }
    return { delivered: true };
  } catch (err) {
    console.error(
      "[intake-email] Resend send failed:",
      err instanceof Error ? err.message : err,
    );
    return { delivered: false, reason: "send_failed" };
  }
}
