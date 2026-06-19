import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// @allow-firm-scope-exception — firm scoping is enforced by requireClientEditAccess(id),
// which verifies the target client belongs to the caller's firm (throws ForbiddenError
// otherwise) before any mutation. The literal getOrgId/requireOrgId grep doesn't see this.

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const { firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const body = (await req.json().catch(() => ({}))) as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return NextResponse.json({ error: "enabled must be boolean" }, { status: 400 });
    }

    await db
      .update(clients)
      .set({ portalEditEnabled: body.enabled })
      .where(eq(clients.id, id));

    await recordAudit({
      action: "portal.edit_toggle",
      resourceType: "portal_binding",
      resourceId: id,
      clientId: id,
      firmId,
      actorKind: "advisor",
      metadata: { enabled: body.enabled },
    });

    return NextResponse.json({ ok: true, enabled: body.enabled });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/clients/[id]/portal/edit-toggle error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
