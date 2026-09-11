// src/lib/notifications/producers/portal.ts
//
// Notification producers for portal binding lifecycle events.
//
// CONTRACT: call these AFTER the business write commits, never inside its
// transaction. enqueueNotifications never throws to its caller.
import "server-only";
import { enqueueNotifications } from "../enqueue";

export async function notifyPortalDisconnected(args: {
  firmId: string;
  advisorId: string;
  clientId: string;
  clientName: string | null;
}): Promise<void> {
  const who = args.clientName ?? "A client";
  await enqueueNotifications({
    firmId: args.firmId,
    // The household's owning advisor, and only them — matching intake.
    recipients: [args.advisorId],
    category: "portal_disconnected",
    // The CLIENT did this, not an advisor. A non-null actor here would
    // filter the recipient out if the ids ever coincided.
    actorUserId: null,
    clientId: args.clientId,
    title: `${who} disconnected their portal access`,
    body: "They can no longer sign in to this household's portal. Their plan and documents are unchanged.",
    url: `/clients/${args.clientId}/portal`,
    entityType: "portal_binding",
    entityId: null,
    // No dedupKey: a disconnect after a reconnect is genuinely new.
    dedupKey: null,
  });
}
