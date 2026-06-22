import { Resend } from "resend";

const DEFAULT_FROM = "Dan Mueller <dan@foundryplanning.com>";
const REPLY_TO = "dan@foundryplanning.com";
const SUBJECT = "Welcome to Foundry";

/** Pure plain-text body for the founder welcome email. */
export function renderWelcomeText(firstName: string | null): string {
  const name = firstName?.trim();
  const greeting = name ? `Hi ${name},` : "Hi there,";
  return `${greeting}

Thanks for joining Foundry. I'm Dan, the founder — I wanted to personally welcome you and let you know I'm here if you need anything.

If you have any questions or run into anything at all, just reply to this email. It comes straight to me.

Glad to have you here.

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
      // eslint-disable-next-line no-console
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
