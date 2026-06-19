import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
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

  const rows = await db
    .select({ firmId: clients.firmId })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1);
  const firmId = rows[0]?.firmId;
  if (!firmId) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  await db
    .update(clients)
    .set({ clerkUserId })
    .where(eq(clients.id, clientId));

  await recordAudit({
    action: "portal.invite.accepted",
    resourceType: "portal_binding",
    resourceId: clientId,
    clientId,
    firmId,
    actorId: "clerk:webhook",
    actorKind: "system",
    metadata: { clerkUserId, event: "invitation.accepted" },
  });

  return NextResponse.json({ ok: true, clientId, clerkUserId });
}
