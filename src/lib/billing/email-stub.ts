import { Resend } from "resend";
import { recordAudit } from "@/lib/audit";
import { renderBillingEmail } from "@/lib/billing/email-templates";

export type BillingEmailKind =
  | "trial_ending_3d"
  | "payment_failed"
  | "payment_action_required";

/**
 * Billing notification send. Always writes a billing.email_queued audit row
 * (auditor evidence that the system attempted to notify) and, when
 * RESEND_API_KEY + BILLING_EMAIL_FROM are configured, sends the matching
 * template via Resend.
 *
 * Best-effort by contract (AD-2): a Resend or audit failure is logged and
 * swallowed — this function must NEVER throw into a webhook handler, or a
 * downed email provider would 500 the webhook and trigger Stripe redelivery.
 */
export async function sendBillingEmail(args: {
  kind: BillingEmailKind;
  to: string;
  firmId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  try {
    await recordAudit({
      action: "billing.email_queued",
      resourceType: "firm",
      resourceId: args.firmId,
      firmId: args.firmId,
      actorId: "system:email-stub",
      metadata: { kind: args.kind, to: args.to, payload: args.payload },
    });
  } catch {
    // Swallow — never break webhook on audit failure.
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.BILLING_EMAIL_FROM;
  if (!apiKey || !from) {
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.log(`[billing-email] ${args.kind} → ${args.to} (Resend not configured)`, args.payload);
    }
    return;
  }

  try {
    const { subject, html } = renderBillingEmail(args.kind, args.payload);
    const resend = new Resend(apiKey);
    await resend.emails.send({ from, to: args.to, subject, html });
  } catch (err) {
    // Best-effort: log and swallow so the webhook handler never 500s on email.
    console.error(
      `[billing-email] Resend send failed for ${args.kind} → ${args.to}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
