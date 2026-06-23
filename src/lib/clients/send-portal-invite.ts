import { clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { recordAudit } from "@/lib/audit";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";

/**
 * Core invite-send logic shared between the portal invite route and the
 * intake-form create+send route. Creates a Clerk invitation, stamps
 * `portalInvitedAt` on the client row, and records an audit entry.
 *
 * Callers are responsible for:
 *  - Verifying `clientId` belongs to `firmId` (e.g. via requireClientEditAccess)
 *    BEFORE calling — the `portalInvitedAt` update is keyed on clientId alone.
 *  - Rate-limiting (checkPortalInviteRateLimit) before calling.
 *  - Catching ClerkAPIResponseError / clerkInviteErrorResponse — this
 *    helper does NOT catch; it lets Clerk errors propagate so each route
 *    can map them appropriately.
 */
export async function sendPortalInvite(args: {
  clientId: string;
  email: string;
  firmId: string;
  callerOrg: string;
  access: "own" | "shared";
}): Promise<{ invitationId: string }> {
  const { clientId, email, firmId, callerOrg, access } = args;

  const cc = await clerkClient();
  const invitation = await cc.invitations.createInvitation({
    emailAddress: email,
    publicMetadata: { clientId },
    redirectUrl: `${APP_URL}/sign-up`,
  });

  await db
    .update(clients)
    .set({ portalInvitedAt: new Date() })
    .where(eq(clients.id, clientId));

  await recordAudit({
    action: "portal.invite.sent",
    resourceType: "portal_invite",
    resourceId: invitation.id,
    clientId,
    firmId,
    metadata: crossFirmAuditMeta({ access }, callerOrg, { email }),
  });

  return { invitationId: invitation.id };
}
