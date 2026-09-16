// src/lib/risk/email.ts
//
// Send the risk-questionnaire link to a client (or spouse). Mirrors
// sendIntakeFormEmail's transport and branding path exactly -- same Resend
// client, same HTML template, same From-header resolution (@/lib/intake) --
// rather than introducing a second mailer. The only differences are the
// link path (built by the caller) and the subject line.
//
// Reports whether the send was actually accepted, because the caller's UI
// tells the advisor so and the send-rtq route writes the flag into the audit
// log -- a bare success there is a record of mail nobody received.
// sendIntakeFormEmail reports the same way; it just distinguishes an unset
// RESEND_API_KEY from a refused send, which this caller has no use for.
import { Resend } from "resend";
import { buildIntakeEmailHtml, buildIntakeFromHeader } from "@/lib/intake/email-template";

const RTQ_EMAIL_SUBJECT = "A few questions about your comfort with investment risk";

// Passed as buildIntakeEmailHtml's `introBody` override -- without it the
// template falls back to DEFAULT_INTAKE_INTRO (@/lib/intake/defaults), which
// describes an unrelated financial-intake form ("income, savings, accounts,
// and goals... 10-15 minutes"). This is short and specific to the RTQ instead.
const RTQ_EMAIL_INTRO =
  "{{advisorName}} has sent you a short questionnaire about your comfort " +
  "with investment risk. It's five questions and takes about two minutes -- " +
  "there are no wrong answers, just what feels true for you.";

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
    const html = buildIntakeEmailHtml({
      link,
      introBody: RTQ_EMAIL_INTRO,
      advisorName,
      advisorEmail,
      firmName,
      clientName,
    });
    // resend.emails.send() resolves { data: null, error } for every non-2xx
    // response rather than throwing — the `error` check is the real net. The
    // catch below only ever sees a transport fault, which is the rarer half.
    const { error } = await resend.emails.send({
      from,
      to,
      subject: RTQ_EMAIL_SUBJECT,
      html,
      replyTo,
    });
    if (error) {
      console.error(
        "[risk-email] Resend rejected the send:",
        error.message ?? error,
      );
      return { delivered: false };
    }
    return { delivered: true };
  } catch (err) {
    console.error(
      "[risk-email] Resend send failed:",
      err instanceof Error ? err.message : err,
    );
    return { delivered: false };
  }
}
