import { Resend } from "resend";
import { recordAudit } from "@/lib/audit";
import { escapeHtml as esc } from "@/lib/html-escape";
import type { FeedbackSubmission } from "./schema";

export interface FeedbackContext {
  firmId: string;
  firmName: string;
  advisorName: string;
  advisorEmail: string;
  userAgent: string;
  submittedAt: string; // ISO
}

export interface FeedbackAttachment {
  filename: string;
  content: Buffer;
}

function subjectFor(s: FeedbackSubmission): string {
  if (s.mode === "support") return `[Support] ${s.subject}`;
  const tag = s.type === "bug" ? "Bug" : "Feature";
  const firstLine = s.message.split("\n")[0]!.slice(0, 80);
  return `[${tag}] ${firstLine}`;
}

/* eslint-disable brand/no-raw-hex -- email HTML requires inline hex; email clients can't resolve CSS brand tokens (same rationale as the allow-listed PDF/print layers) */
export function buildFeedbackEmail(
  s: FeedbackSubmission,
  ctx: FeedbackContext,
): { subject: string; html: string } {
  const rows: Array<[string, string]> = [
    ["From", `${ctx.advisorName} <${ctx.advisorEmail}>`],
    ["Firm", ctx.firmName],
    ["Firm ID", ctx.firmId],
    ["Page", s.pageUrl ?? "—"],
    ["When", ctx.submittedAt],
    ["User agent", ctx.userAgent],
  ];
  if (s.mode === "feedback") rows.unshift(["Type", s.type]);

  const meta = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:2px 12px 2px 0;color:#6b7280">${esc(k)}</td><td>${esc(v)}</td></tr>`,
    )
    .join("");

  const html = `<div style="font-family:system-ui,sans-serif;font-size:14px;color:#111">
<table style="border-collapse:collapse;margin-bottom:16px">${meta}</table>
<div style="white-space:pre-wrap;border-top:1px solid #e5e7eb;padding-top:12px">${esc(
    s.message,
  )}</div>
</div>`;

  return { subject: subjectFor(s), html };
}
/* eslint-enable brand/no-raw-hex */

/** The route's fallback when Clerk holds no address for the user. */
const UNKNOWN_EMAIL = "unknown@unknown";

/** Only mail an address that can plausibly be delivered to. Sending the
 * acknowledgement to the `unknown@unknown` sentinel would earn a hard bounce
 * against the verified domain's reputation for every such submission. */
function isDeliverable(email: string): boolean {
  return email !== UNKNOWN_EMAIL && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

/** What the submitter called it, in their words — used in the subject and body. */
function noun(s: FeedbackSubmission): string {
  if (s.mode === "support") return "message";
  return s.type === "bug" ? "bug report" : "product request";
}

function acknowledgementSubject(s: FeedbackSubmission): string {
  return s.mode === "support"
    ? `We got your message: ${s.subject}`
    : `We got your ${noun(s)}`;
}

/* eslint-disable brand/no-raw-hex -- email HTML requires inline hex; mail clients can't resolve CSS brand tokens */
/**
 * The receipt the submitter gets. Deliberately says nothing about timing we
 * can't honor: it confirms arrival and quotes their words back so they have a
 * record, and stops there.
 */
export function buildFeedbackAcknowledgementEmail(
  s: FeedbackSubmission,
  ctx: FeedbackContext,
): { subject: string; html: string } {
  const firstName = ctx.advisorName.trim().split(/\s+/)[0] || "there";
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f6f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1c1a">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e0;border-radius:12px;padding:28px">
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6">Hi ${esc(firstName)},</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.6">
      Thanks — we received your ${esc(noun(s))} and it's with the Foundry Planning
      team for review. If we need more detail, we'll reply to this email.
    </p>
    <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#6b6b64">What you sent</p>
    <div style="white-space:pre-wrap;font-size:14px;line-height:1.6;border-left:3px solid #e4e4e0;padding:2px 0 2px 14px;color:#3f3f3a">${esc(
      s.message,
    )}</div>
    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6b6b64">
      No need to do anything else — this is just so you know it arrived.
    </p>
  </div>
</body></html>`;
  return { subject: acknowledgementSubject(s), html };
}
/* eslint-enable brand/no-raw-hex */

/**
 * Send a support/feedback submission to the support inbox, then send the
 * submitter a receipt so they know it landed. Mirrors
 * `lib/billing/email-stub.ts`: always audit-logs, sends via Resend only when
 * configured, and never throws (best-effort) — the route maps its own errors.
 */
export async function sendFeedbackEmail(args: {
  submission: FeedbackSubmission;
  context: FeedbackContext;
  attachments: FeedbackAttachment[];
}): Promise<void> {
  const { submission, context, attachments } = args;
  const action =
    submission.mode === "support" ? "support.message_sent" : "feedback.submitted";

  try {
    await recordAudit({
      action,
      resourceType: "firm",
      resourceId: context.firmId,
      firmId: context.firmId,
      metadata: {
        mode: submission.mode,
        type: submission.mode === "feedback" ? submission.type : undefined,
        pageUrl: submission.pageUrl,
        advisorEmail: context.advisorEmail,
        attachmentCount: attachments.length,
      },
    });
  } catch {
    // Never break the request on an audit failure.
  }

  const apiKey = process.env.RESEND_API_KEY;
  // Support mail must come *from* a support-branded sender, not billing. An
  // explicit SUPPORT_EMAIL_FROM still wins; otherwise default to the support
  // inbox (an address on the Resend-verified foundryplanning.com domain).
  const from =
    process.env.SUPPORT_EMAIL_FROM ?? "Foundry Support <support@foundryplanning.com>";
  const to = process.env.SUPPORT_EMAIL ?? "support@foundryplanning.com";
  if (!apiKey) {
    if (process.env.NODE_ENV === "development") {
      console.log(`[feedback-email] ${action} (Resend not configured)`, {
        to,
        submission,
      });
    }
    return;
  }

  const resend = new Resend(apiKey);

  try {
    const { subject, html } = buildFeedbackEmail(submission, context);
    await resend.emails.send({
      from,
      to,
      replyTo: context.advisorEmail,
      subject,
      html,
      attachments: attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
      })),
    });
  } catch (err) {
    console.error(
      `[feedback-email] Resend send failed for ${action}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // Separate try/catch, not a second statement in the one above: a failed
  // support send must not swallow the receipt, and a failed receipt must not
  // look like the submission itself was lost. Attachments are NOT echoed back —
  // the submitter already has their own screenshots.
  if (!isDeliverable(context.advisorEmail)) return;
  try {
    const ack = buildFeedbackAcknowledgementEmail(submission, context);
    const { error } = await resend.emails.send({
      from,
      to: context.advisorEmail,
      replyTo: to,
      subject: ack.subject,
      html: ack.html,
    });
    if (error) {
      console.error(
        "[feedback-email] Resend rejected the acknowledgement:",
        error.message ?? error,
      );
    }
  } catch (err) {
    console.error(
      "[feedback-email] acknowledgement send failed:",
      err instanceof Error ? err.message : err,
    );
  }
}
