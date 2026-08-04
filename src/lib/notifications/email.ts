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
    }
    return { delivered: false };
  }
  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: FROM,
      to: args.to,
      subject: args.subject,
      html: args.html,
    });
    return { delivered: true };
  } catch (err) {
    console.error(
      "[notification-digest] Resend send failed:",
      err instanceof Error ? err.message : err,
    );
    return { delivered: false };
  }
}
