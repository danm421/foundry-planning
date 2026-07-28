// src/lib/risk/email.ts
//
// Send the risk-questionnaire link to a client (or spouse). Mirrors
// sendIntakeFormEmail's transport and branding path exactly -- same Resend
// client, same HTML template, same From-header resolution (@/lib/intake) --
// rather than introducing a second mailer. The only differences are the
// link path (built by the caller) and the subject line.
//
// Unlike sendIntakeFormEmail, this reports whether a send was actually
// dispatched. sendIntakeFormEmail is intentionally silent (logs and returns
// void) so intake-form callers never see a delivery failure; here the
// caller's UI needs to tell the advisor when RESEND_API_KEY is unset or the
// transport threw, instead of showing a bare success for an email nobody
// received.
import { Resend } from "resend";
import { buildIntakeEmailHtml, buildIntakeFromHeader } from "@/lib/intake/email-template";

const RTQ_EMAIL_SUBJECT = "A few questions about your comfort with investment risk";

export async function sendRiskQuestionnaireEmail(args: {
  to: string;
  link: string;
  fromName?: string;
  replyTo?: string;
  advisorName?: string;
  advisorEmail?: string;
  firmName?: string;
  clientName?: string;
}): Promise<{ delivered: boolean }> {
  const { to, link, fromName, replyTo, advisorName, advisorEmail, firmName, clientName } = args;

  const apiKey = process.env.RESEND_API_KEY;
  const from = buildIntakeFromHeader(fromName, firmName);

  if (!apiKey) {
    if (process.env.NODE_ENV === "development") {
      console.log("[risk-email] Resend not configured — skipping send", { to, link });
    }
    return { delivered: false };
  }

  try {
    const resend = new Resend(apiKey);
    const html = buildIntakeEmailHtml({ link, advisorName, advisorEmail, firmName, clientName });
    await resend.emails.send({
      from,
      to,
      subject: RTQ_EMAIL_SUBJECT,
      html,
      replyTo,
    });
    return { delivered: true };
  } catch (err) {
    console.error(
      "[risk-email] Resend send failed:",
      err instanceof Error ? err.message : err,
    );
    return { delivered: false };
  }
}
