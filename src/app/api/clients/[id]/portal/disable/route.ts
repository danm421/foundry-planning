import { NextResponse } from "next/server";
import { clerkClient } from "@clerk/nextjs/server";
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

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const { firmId, client } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    // clerkUserId comes directly from the client row returned by requireClientEditAccess
    const clerkUserId = client.clerkUserId ?? null;

    if (clerkUserId) {
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
      actorKind: "advisor",
      metadata: { hadClerkUser: !!clerkUserId },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/portal/disable error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
