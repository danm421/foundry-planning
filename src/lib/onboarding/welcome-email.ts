import { Resend } from "resend";

const DEFAULT_FROM = "Dan Mueller <dan@foundryplanning.com>";
const REPLY_TO = "dan@foundryplanning.com";
const SUBJECT = "Welcome to Foundry Planning";

/** Pure plain-text body for the signup welcome email. */
export function renderWelcomeText(firstName: string | null): string {
  const name = firstName?.trim();
  const greeting = name ? `Hi ${name},` : "Hi there,";
  return `${greeting}

Thanks for signing up for Foundry Planning. I hope you find it useful.

If you have a question, or something doesn't work the way you expect, just reply to this email. It comes straight to me.

Glad you're here.

Dan
Foundry Planning`;
}

/**
 * Send a personal, plain-text welcome email to a newly-signed-up user.
 *
 * Best-effort by contract: this function NEVER throws. It is called from the
 * Clerk user.created webhook, where an unhandled throw would 500 the endpoint
 * and trigger a Svix retry-storm. A missing RESEND_API_KEY (local dev) logs and
 * returns; a Resend failure is logged and swallowed.
 */
export async function sendWelcomeEmail(args: {
  to: string;
  firstName: string | null;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.WELCOME_EMAIL_FROM || DEFAULT_FROM;

  if (!apiKey) {
    if (process.env.NODE_ENV === "development") {
      console.log(`[welcome-email] → ${args.to} (Resend not configured)`);
    }
    return;
  }

  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from,
      to: args.to,
      replyTo: REPLY_TO,
      subject: SUBJECT,
      text: renderWelcomeText(args.firstName),
    });
  } catch (err) {
    console.error(
      `[welcome-email] Resend send failed → ${args.to}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
