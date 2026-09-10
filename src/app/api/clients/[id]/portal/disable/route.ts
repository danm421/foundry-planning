import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import {
  resolveClientPortalUserId,
  revokeBinding,
  revokeAllForUser,
} from "@/lib/portal/bindings";

export const dynamic = "force-dynamic";

// @allow-firm-scope-exception — firm scoping is enforced by requireClientEditAccess(id),
// which verifies the target client belongs to the caller's firm (throws ForbiddenError
// otherwise) before any mutation. The literal getOrgId/requireOrgId grep doesn't see this.

/**
 * Two very different acts behind one endpoint, chosen by `mode`:
 *
 *  - `revoke` ends THIS household's binding. The person keeps their Foundry
 *    login, their password, and every other firm they are connected to.
 *  - `delete_login` destroys the Clerk account itself, which necessarily
 *    disconnects them from every firm.
 *
 * `mode` is REQUIRED and has no default: an older client that sends no body
 * gets a 400 rather than silently having a person's login deleted.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const { userId } = await requireOrgAndUser();
    const { firmId, client } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const body = (await req.json().catch(() => ({}))) as { mode?: unknown };
    if (body.mode !== "revoke" && body.mode !== "delete_login") {
      // No default. Deleting a person's login must always be an explicit ask.
      return NextResponse.json(
        { error: "mode must be 'revoke' or 'delete_login'" },
        { status: 400 },
      );
    }

    // DEPLOY-1 DUAL-READ. A client who ACCEPTED an access request has a
    // `portal_bindings` row and no `clients.clerk_user_id` at all, so reading
    // the legacy column alone would leave both modes silently acting on
    // nobody. The resolver — not this route — decides whether that column may
    // still answer: a household whose access was already revoked gets null,
    // because the revoked row is what ended access and the column survives it
    // by design. Removed in Task 15.
    const clerkUserId = await resolveClientPortalUserId(id, client.clerkUserId ?? null);

    if (body.mode === "revoke") {
      // `revokeBinding` writes the `portal.access.revoked_by_advisor` audit row
      // itself, against the binding it actually ended — a second one here would
      // double-count a single advisor action in the SOC-2 log.
      //
      // The legacy column is deliberately NOT cleared: the `revoked` row is
      // what ends access (`getPortalClientRef` stops falling back to that
      // column the moment this table has settled anything for the login), and
      // clearing it would take a rollback of Deploy 1 with it.
      const ended = clerkUserId
        ? await revokeBinding({ clientId: id, clerkUserId, endedBy: "advisor", actorId: userId })
        : false;

      return NextResponse.json({ ok: true, mode: "revoke", ended });
    }

    // delete_login — destructive, and global to that person.
    if (clerkUserId) {
      // Every firm's binding ends, not only this one: the Clerk account is
      // about to stop existing, and a binding pointing at a deleted login can
      // never resolve again.
      //
      // Those rows all record `ended_by = 'advisor'`, including firms whose
      // advisor did nothing. `portal_binding_ended_by` is closed at
      // ("none", "client", "advisor") and holds no value for "their whole login
      // was deleted"; widening it is a migration this deploy does not take. The
      // honest record of what happened is the `portal.access.disabled` audit
      // below, whose metadata carries `mode: "delete_login"`.
      //
      // Bindings end BEFORE the Clerk delete so a failure between the two
      // leaves access ended rather than a deleted account with live bindings.
      const endedBindings = await revokeAllForUser(clerkUserId);
      // Server log ONLY, deliberately never the audit row: audit metadata is
      // read back on advisor-facing surfaces (`list-client-activity.ts`,
      // `list-audit-rows.ts` both select it), and a count above 1 tells the
      // acting advisor how many OTHER firms hold this person's login. The
      // spec's non-goal is explicit that no surface ever does that.
      console.info(
        `[portal.disable] delete_login ended ${endedBindings} binding(s) for client ${id}`,
      );

      const cc = await clerkClient();
      try {
        await cc.users.deleteUser(clerkUserId);
      } catch (err) {
        // User may already be deleted on Clerk's side — proceed with the null update.
        console.error(
          "[portal.disable] Clerk deleteUser failed:",
          err instanceof Error ? err.message : err,
        );
      }
    }

    await db
      .update(clients)
      .set({ clerkUserId: null, portalInvitedAt: null })
      .where(eq(clients.id, id));

    await recordAudit({
      action: "portal.access.disabled",
      resourceType: "portal_binding",
      resourceId: id,
      clientId: id,
      firmId,
      actorId: userId,
      actorKind: "advisor",
      metadata: { hadClerkUser: !!clerkUserId, mode: "delete_login" },
    });

    return NextResponse.json({ ok: true, mode: "delete_login" });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/portal/disable error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
