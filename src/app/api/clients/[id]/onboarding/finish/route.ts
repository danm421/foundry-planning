import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const [row] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // No completeness gate: a step the advisor passed through empty is
    // recorded as skipped, and Review shows what is thin. Finishing with
    // gaps is the advisor's call, not something to block on the server.
    const now = new Date();
    await db
      .update(clients)
      .set({ onboardingCompletedAt: now, updatedAt: now })
      .where(eq(clients.id, id));
    await recordAudit({
      firmId,
      action: "client.onboarding.finish",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      metadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return NextResponse.json({ ok: true, completedAt: now.toISOString() });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/onboarding/finish error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
