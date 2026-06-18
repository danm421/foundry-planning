import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { deriveStepStatuses } from "@/lib/onboarding/step-status";
import type { OnboardingState } from "@/lib/onboarding/types";
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
      .select({ id: clients.id, state: clients.onboardingState })
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { effectiveTree } = await loadEffectiveTree(id, firmId, "base", {});
    const statuses = deriveStepStatuses(
      effectiveTree,
      (row.state as OnboardingState | null) ?? {},
    );

    const blockers = statuses
      .filter((s) => s.slug !== "review" && s.kind !== "complete" && s.kind !== "skipped")
      .map((s) => s.slug);

    if (blockers.length > 0) {
      return NextResponse.json({ error: "Onboarding incomplete", blockers }, { status: 409 });
    }

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
