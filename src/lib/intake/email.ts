import { Resend } from "resend";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/* eslint-disable brand/no-raw-hex -- email HTML requires inline hex; email clients can't resolve CSS brand tokens */
function buildIntakeEmailHtml(args: {
  link: string;
  advisorName?: string;
  householdName?: string;
}): string {
  const { link, advisorName, householdName } = args;

  const greeting = householdName
    ? `<p>Hello${householdName ? ` ${esc(householdName)}` : ""},</p>`
    : `<p>Hello,</p>`;

  const advisorLine = advisorName
    ? `<p style="color:#6b7280;font-size:13px">Sent by ${esc(advisorName)}</p>`
    : "";

  return `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111;max-width:560px;margin:0 auto">
  <div style="background:#1e3a5f;padding:20px 24px;border-radius:6px 6px 0 0">
    <span style="color:#fff;font-size:18px;font-weight:600">Foundry Planning</span>
  </div>
  <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 6px 6px">
    ${greeting}
    <p>Your advisor has shared a data-collection form with you. Please take a few minutes to fill it out — it helps us build an accurate picture of your financial situation.</p>
    <p style="margin:24px 0">
      <a href="${esc(link)}" style="background:#1e3a5f;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;font-weight:500;display:inline-block">
        Open My Form
      </a>
    </p>
    <p style="color:#6b7280;font-size:12px">Or copy this link into your browser:<br/>${esc(link)}</p>
    ${advisorLine}
  </div>
</div>`;
}
/* eslint-enable brand/no-raw-hex */

/**
 * Send a client intake form invitation email via Resend. Best-effort: if
 * RESEND_API_KEY is unset, logs in development and returns silently. Errors
 * from Resend are caught and logged — this function never throws to its caller.
 */
export async function sendIntakeFormEmail(args: {
  to: string;
  link: string;
  advisorName?: string;
  householdName?: string;
}): Promise<void> {
  const { to, link, advisorName, householdName } = args;

  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.INTAKE_EMAIL_FROM ?? "Foundry <noreply@foundryplanning.com>";

  if (!apiKey) {
    if (process.env.NODE_ENV === "development") {
      console.log("[intake-email] Resend not configured — skipping send", {
        to,
        link,
      });
    }
    return;
  }

  try {
    const resend = new Resend(apiKey);
    const html = buildIntakeEmailHtml({ link, advisorName, householdName });
    await resend.emails.send({
      from,
      to,
      subject: "Your financial planning form is ready",
      html,
    });
  } catch (err) {
    console.error(
      "[intake-email] Resend send failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
