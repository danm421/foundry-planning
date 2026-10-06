import { clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { isDuplicateInvitationError } from "@/lib/clients/portal-invite-errors";
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
  const params = {
    emailAddress: email,
    publicMetadata: { clientId },
    redirectUrl: `${APP_URL}/sign-up`,
  };
  const invitation = await cc.invitations
    .createInvitation(params)
    .catch(async (err: unknown) => {
      if (!(await blockedOnlyByAnAcceptedInvite(cc, err, email))) throw err;
      return cc.invitations.createInvitation({ ...params, ignoreExisting: true });
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

/**
 * Clerk keeps an ACCEPTED invitation forever and refuses any new one to that
 * address — even after Delete login removed the account it created — with the
 * same code a PENDING invitation earns. So ask Clerk which it is: with no
 * account and nothing pending, the refusal is only the old accepted invitation,
 * and forcing past it (`ignoreExisting`) is safe.
 */
async function blockedOnlyByAnAcceptedInvite(
  cc: Awaited<ReturnType<typeof clerkClient>>,
  err: unknown,
  email: string,
): Promise<boolean> {
  if (!isDuplicateInvitationError(err)) return false;

  const [pending, users] = await Promise.all([
    cc.invitations.getInvitationList({ status: "pending", query: email }),
    cc.users.getUserList({ emailAddress: [email] }),
  ]);
  const sameEmail = (a: string) => a.toLowerCase() === email.toLowerCase();
  return users.data.length === 0 && !pending.data.some((inv) => sameEmail(inv.emailAddress));
}
