import { Resend } from "resend";
import { recordAudit } from "@/lib/audit";
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

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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

/**
 * Send a support/feedback submission to the support inbox. Mirrors
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

  try {
    const { subject, html } = buildFeedbackEmail(submission, context);
    const resend = new Resend(apiKey);
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
}
