// src/lib/notifications/email.ts
//
// Resend transport for the daily digest. Mirrors src/lib/intake/email.ts's
// contract: no RESEND_API_KEY means log-and-skip rather than throw, so a local
// or preview environment without mail configured runs the cron harmlessly.
//
// Unlike sendIntakeFormEmail this REPORTS delivery, because the digest worker
// must not stamp rows as emailed for a send that never happened.
import { Resend } from "resend";

const FROM = "Foundry Planning <alerts@foundryplanning.com>";

export async function sendDigestEmail(args: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ delivered: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === "development") {
      console.log("[notification-digest] Resend not configured — skipping", args.to);
    } else {
      // NOT a silent skip outside development. This is an unattended cron: with
      // the key missing every row stays emailPending forever, the backlog grows
      // without bound, and the oldest rows consume the front of MAX_ROWS_PER_RUN
      // on every later run. The only other signal is a counter in a JSON body
      // nobody reads, so log loudly enough to show up in Vercel's error view.
      console.error(
        "[notification-digest] RESEND_API_KEY is not set — the digest cannot send",
      );
    }
    return { delivered: false };
  }
  try {
    const resend = new Resend(apiKey);
    // resend.emails.send() never throws for a rejected send — it resolves
    // { data: null, error } for every non-2xx response (rate limit, invalid
    // recipient, unverified domain, ...). The try/catch below is belt-and-
    // braces for a genuinely thrown error; the `error` check is the real net.
    const { error } = await resend.emails.send({
      from: FROM,
      to: args.to,
      subject: args.subject,
      html: args.html,
    });
    if (error) {
      console.error(
        "[notification-digest] Resend rejected the send:",
        error.message ?? error,
      );
      return { delivered: false };
    }
    return { delivered: true };
  } catch (err) {
    console.error(
      "[notification-digest] Resend send failed:",
      err instanceof Error ? err.message : err,
    );
    return { delivered: false };
  }
}
