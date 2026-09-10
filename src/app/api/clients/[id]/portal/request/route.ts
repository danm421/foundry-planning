import { NextResponse } from "next/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { recordAudit } from "@/lib/audit";
import { deletePendingBinding } from "@/lib/portal/bindings";

export const dynamic = "force-dynamic";

// @allow-firm-scope-exception — firm scoping is enforced by requireClientEditAccess(id),
// which verifies the target client belongs to the caller's firm (throws ForbiddenError
// otherwise) before any mutation. The literal getOrgId/requireOrgId grep doesn't see this.

/**
 * Withdraw an outstanding access request.
 *
 * The one thing an advisor could not undo. A request sent to a mistyped address
 * names the firm, the advisor AND the household on the recipient's accept
 * screen, and accepting it hands them that household's plan and documents —
 * with nothing on Manage Portal offering to take it back. `DELETE /invite`
 * revokes Clerk INVITATIONS, which a request is not: the recipient already has
 * a Foundry account, so all that exists is the `pending` binding row.
 *
 * Same authorization as its siblings — `requireClientEditAccess(id)` scopes it
 * to a household this advisor may edit, and `deletePendingBinding` re-scopes
 * the delete to (bindingId, clientId, status='pending') so a stray id cannot
 * reach another household's row or undo a decision the client already made.
 *
 * Deliberately NOT behind `requireClientPortalEntitlement`, matching the invite
 * route's DELETE: taking access away must keep working for a firm whose portal
 * entitlement has lapsed.
 */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const body = (await req.json().catch(() => ({}))) as { bindingId?: unknown };
    if (typeof body.bindingId !== "string") {
      return NextResponse.json({ error: "bindingId required" }, { status: 400 });
    }

    const removed = await deletePendingBinding(body.bindingId, id);
    if (!removed) {
      // Accepted, declined or expired between the page render and this click.
      return NextResponse.json(
        { error: "That request is no longer pending." },
        { status: 404 },
      );
    }

    // `portal.invite.revoked` rather than a new action: the closed AuditAction
    // union already names this act — an advisor withdrawing an outstanding
    // offer of access — and the metadata says which of the two kinds it was.
    await recordAudit({
      action: "portal.invite.revoked",
      resourceType: "portal_binding",
      resourceId: body.bindingId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { mode: "access_request" }),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id]/portal/request error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
