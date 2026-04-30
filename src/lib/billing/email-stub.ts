import { recordAudit } from "@/lib/audit";

export type BillingEmailKind =
  | "trial_ending_3d"
  | "payment_failed"
  | "payment_action_required";

/**
 * Email-side-effect stub. Phase 3 ships every webhook handler that flips
 * subscription status + audit log + Clerk metadata; the user-notification
 * email send is intentionally deferred to a later "email infra" phase.
 *
 * This function:
 *   - Writes a billing.email_queued audit row capturing kind, recipient,
 *     and payload (auditor evidence that the system attempted to notify).
 *   - Never throws — webhook handler must not 500 because audit failed.
 *
 * When an email vendor lands, replace the body; the signature stays.
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
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.log(`[email-stub] ${args.kind} → ${args.to}`, args.payload);
    }
  } catch {
    // Swallow — never break webhook on email-stub failure.
  }
}
