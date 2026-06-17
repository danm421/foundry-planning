import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { isStepSlug, type OnboardingState } from "@/lib/onboarding/types";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

const patchSchema = z
  .object({
    skippedSteps: z.array(z.string()).optional(),
    lastStepVisited: z.string().optional(),
    activeImportId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const body = await request.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const [existing] = await db
      .select({ id: clients.id, state: clients.onboardingState })
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const current = (existing.state as OnboardingState | null) ?? {};
    const next: OnboardingState = { ...current };

    if (parsed.data.skippedSteps) {
      next.skippedSteps = parsed.data.skippedSteps.filter(isStepSlug);
    }
    if (parsed.data.lastStepVisited && isStepSlug(parsed.data.lastStepVisited)) {
      next.lastStepVisited = parsed.data.lastStepVisited;
    }
    if (parsed.data.activeImportId !== undefined) {
      if (parsed.data.activeImportId === null) {
        delete next.activeImportId;
      } else {
        next.activeImportId = parsed.data.activeImportId;
      }
    }

    await db
      .update(clients)
      .set({ onboardingState: next, updatedAt: new Date() })
      .where(eq(clients.id, id));
    await recordAudit({
      firmId,
      action: "client.onboarding_state.update",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        skippedSteps: next.skippedSteps ?? [],
        lastStepVisited: next.lastStepVisited ?? null,
        activeImportId: next.activeImportId ?? null,
      }),
    });

    return NextResponse.json({ ok: true, state: next });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PATCH /api/clients/[id]/onboarding error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
