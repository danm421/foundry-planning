import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { clerkInviteErrorResponse } from "@/lib/clients/portal-invite-errors";
import { checkPortalInviteRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { sendPortalInvite } from "@/lib/clients/send-portal-invite";

export const dynamic = "force-dynamic";

// @allow-firm-scope-exception — firm scoping is enforced by requireClientEditAccess(id),
// which verifies the target client belongs to the caller's firm (throws ForbiddenError
// otherwise) before any mutation. The literal getOrgId/requireOrgId grep doesn't see this.

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const limit = await checkPortalInviteRateLimit(firmId);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded", reason: limit.reason },
        { status: 429 },
      );
    }

    const body = (await req.json().catch(() => ({}))) as { email?: string };
    if (!body.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }

    const { invitationId } = await sendPortalInvite({
      clientId: id,
      email: body.email,
      firmId,
      callerOrg,
      access,
    });

    return NextResponse.json({ ok: true, invitationId });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    // Clerk rejects emails that already have an account or a pending invitation —
    // surface those as a clear 409 instead of an opaque 500.
    const clerkRes = clerkInviteErrorResponse(err);
    if (clerkRes) {
      return NextResponse.json({ error: clerkRes.error }, { status: clerkRes.status });
    }
    console.error("POST /api/clients/[id]/portal/invite error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const cc = await clerkClient();
    const list = await cc.invitations.getInvitationList({ status: "pending" });
    const matches = (list.data ?? []).filter(
      (inv) =>
        (inv.publicMetadata as { clientId?: string } | undefined)?.clientId === id,
    );

    for (const inv of matches) {
      await cc.invitations.revokeInvitation(inv.id);
    }

    await db
      .update(clients)
      .set({ portalInvitedAt: null })
      .where(eq(clients.id, id));

    await recordAudit({
      action: "portal.invite.revoked",
      resourceType: "portal_invite",
      resourceId: id,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { revoked: matches.length }),
    });

    return NextResponse.json({ ok: true, revoked: matches.length });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id]/portal/invite error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
