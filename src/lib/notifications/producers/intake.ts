// src/lib/notifications/producers/intake.ts
//
// Notification producers for the intake-form lifecycle. Each is a thin,
// named wrapper around enqueueNotifications so the write site stays readable
// and the title/url/dedup conventions are testable in one place.
//
// CONTRACT: call these AFTER the business write commits, never inside its
// transaction. enqueueNotifications never throws, but a call inside a tx would
// still tie a client's submission to a notification insert.
import "server-only";
import { enqueueNotifications } from "../enqueue";

export async function notifyIntakeSubmitted(args: {
  firmId: string;
  advisorId: string;
  clientId: string | null;
  formId: string;
  recipientName: string | null;
}): Promise<void> {
  const who = args.recipientName ?? "A client";
  await enqueueNotifications({
    firmId: args.firmId,
    // Decision 1: the owning advisor, and only them.
    recipients: [args.advisorId],
    category: "intake_submitted",
    // The CLIENT submitted this, not an advisor. A non-null actor here would
    // filter the recipient out if the ids ever coincided.
    actorUserId: null,
    clientId: args.clientId,
    title: `${who} submitted their intake form`,
    body: null,
    url: `/data-collection/${args.formId}`,
    entityType: "intake_form",
    entityId: args.formId,
    // No dedupKey: a resubmission is genuinely new information.
    dedupKey: null,
  });
}
