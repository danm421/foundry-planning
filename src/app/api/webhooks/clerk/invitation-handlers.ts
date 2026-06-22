import { NextResponse } from "next/server";
import { bindClerkUserToClient } from "@/lib/portal/bind-portal-user";
import type { ClerkEvent } from "./handler";

type InvitationAcceptedData = {
  public_metadata?: { clientId?: string };
  created_user_id?: string;
};

/**
 * Handle the `invitation.accepted` Clerk event for portal invites:
 * pulls clientId from the invitation's public metadata and binds the
 * newly-created Clerk user to that client via `clients.clerk_user_id`.
 *
 * Returns null for events this handler doesn't own (caller continues
 * the dispatch chain). Returns a Response otherwise.
 */
export async function dispatchClerkInvitation(
  evt: ClerkEvent,
): Promise<Response | null> {
  if (evt.type !== "invitation.accepted") return null;

  const data = evt.data as InvitationAcceptedData;
  const clientId = data.public_metadata?.clientId;
  const clerkUserId = data.created_user_id;

  if (!clientId || !clerkUserId) {
    console.error(
      "[webhook.clerk] invitation.accepted missing metadata.clientId or created_user_id",
    );
    return NextResponse.json(
      { error: "Missing clientId or created_user_id" },
      { status: 400 },
    );
  }

  // Wrap in try/catch so a transient DB failure returns 500 and signals
  // Clerk to retry. bindClerkUserToClient is idempotent (a repeat bind to
  // the same user is a no-op success), so retries are safe.
  let result: Awaited<ReturnType<typeof bindClerkUserToClient>>;
  try {
    result = await bindClerkUserToClient(clientId, clerkUserId, "webhook");
  } catch (err) {
    console.error(
      "[webhook.clerk] invitation.accepted bind failed:",
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: "bind failed" }, { status: 500 });
  }

  if (!result.ok) {
    if (result.reason === "client_not_found") {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    // already_bound_other: anomalous but harmless — ack so Clerk doesn't retry.
    console.warn(
      "[webhook.clerk] invitation.accepted for a client already bound to another user",
    );
    return NextResponse.json({ ok: false, reason: result.reason });
  }

  return NextResponse.json({ ok: true, clientId, clerkUserId });
}
