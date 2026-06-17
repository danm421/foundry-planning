import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { clients, clientShares } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ForbiddenError } from "@/lib/authz";
import { UnauthorizedError } from "@/lib/db-helpers";
import { resolveRecipientByEmail, isMemberOfFirm } from "./share-recipients";
import { recordAudit } from "@/lib/audit";

/**
 * Throws unless the caller is authenticated AND belongs to the client's
 * owning firm AND is either the owning advisor or an org:admin.
 *
 * Returns { client, firmId, ownerUserId } for use by the calling handler.
 */
export async function requireShareManageAccess(clientId: string): Promise<{
  client: typeof clients.$inferSelect;
  firmId: string;
  ownerUserId: string;
}> {
  const { userId, orgId, orgRole } = await auth();
  if (!userId) throw new UnauthorizedError();

  const [client] = await db.select().from(clients).where(eq(clients.id, clientId));
  if (!client) throw new ForbiddenError("Client not found or access denied");

  const inOwningFirm = orgId === client.firmId;
  const isOwner = userId === client.advisorId;
  const isAdmin = orgRole === "org:admin";

  if (!inOwningFirm || (!isOwner && !isAdmin)) {
    throw new ForbiddenError("Client not found or access denied");
  }

  return { client, firmId: client.firmId, ownerUserId: client.advisorId };
}

type CreateArgs = {
  scope: "all" | "client";
  email: string;
  permission: "view" | "edit";
  firmId: string;
  ownerUserId: string;
  clientId: string | null;
  actorId: string;
};

type CreateResult =
  | { ok: true; share: typeof clientShares.$inferSelect }
  | { ok: false; status: number; error: string };

/**
 * Resolve an email to a Foundry user, check they're not already in the firm,
 * insert a client_share row, and emit an audit event.
 *
 * Returns a typed result object — callers map status codes to HTTP responses.
 * Only a Postgres unique-violation (23505) is caught and mapped to 409; all
 * other errors propagate for the route handler to log as 500.
 */
export async function createShare(args: CreateArgs): Promise<CreateResult> {
  const recipient = await resolveRecipientByEmail(args.email);
  if (!recipient) {
    return { ok: false, status: 404, error: "No Foundry user found with that email." };
  }

  if (await isMemberOfFirm(recipient.userId, args.firmId)) {
    return {
      ok: false,
      status: 409,
      error: "That user is already a member of this firm and has access.",
    };
  }

  try {
    const [share] = await db
      .insert(clientShares)
      .values({
        firmId: args.firmId,
        ownerUserId: args.ownerUserId,
        recipientUserId: recipient.userId,
        recipientEmail: recipient.email,
        scope: args.scope,
        clientId: args.clientId,
        permission: args.permission,
        createdBy: args.actorId,
      })
      .returning();

    await recordAudit({
      action: "client_share.create",
      resourceType: "client_share",
      resourceId: share.id,
      clientId: args.clientId,
      firmId: args.firmId,
      metadata: {
        scope: args.scope,
        permission: args.permission,
        recipientEmail: recipient.email,
      },
    });

    return { ok: true, share };
  } catch (e) {
    // Unique partial-index violation = duplicate active grant.
    // The Neon/drizzle driver surfaces the Postgres code directly on the
    // thrown error object (not via a nested .cause) — matches how wills/route.ts
    // handles 23505.
    const code =
      typeof e === "object" && e !== null && "code" in e
        ? (e as { code?: string }).code
        : undefined;
    if (code === "23505") {
      return { ok: false, status: 409, error: "That recipient already has this share." };
    }
    throw e; // real DB errors propagate (route maps to 500)
  }
}

type RevokerCaller = {
  userId: string;
  orgId: string | null;
  orgRole: string | null | undefined;
};

/**
 * Revoke an active share. Caller must be the share owner OR an org:admin of
 * the owning firm.
 */
export async function revokeShare(
  shareId: string,
  caller: RevokerCaller,
): Promise<{ ok: true }> {
  const [share] = await db
    .select()
    .from(clientShares)
    .where(eq(clientShares.id, shareId));

  if (!share || share.revokedAt) throw new ForbiddenError("Share not found");

  const isOwner = caller.userId === share.ownerUserId;
  const isAdmin = caller.orgId === share.firmId && caller.orgRole === "org:admin";

  if (!isOwner && !isAdmin) throw new ForbiddenError("Share not found");

  await db
    .update(clientShares)
    .set({ revokedAt: new Date() })
    .where(eq(clientShares.id, shareId));

  await recordAudit({
    action: "client_share.revoke",
    resourceType: "client_share",
    resourceId: shareId,
    clientId: share.clientId,
    firmId: share.firmId,
    metadata: { scope: share.scope },
  });

  return { ok: true };
}
