import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { mergeQuickStartState, type QuickStartState } from "@/lib/quick-start/state";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

const patchSchema = z
  .object({
    lastStepVisited: z.string().optional(),
    completed: z.boolean().optional(),
    dismissed: z.boolean().optional(),
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
      .select({ id: clients.id, state: clients.quickStartState })
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const current = (existing.state as QuickStartState | null) ?? {};
    const next = mergeQuickStartState(current, parsed.data, new Date().toISOString());

    await db
      .update(clients)
      .set({ quickStartState: next, updatedAt: new Date() })
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    await recordAudit({
      firmId,
      action: "client.quick_start_state.update",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        lastStepVisited: next.lastStepVisited ?? null,
        completedAt: next.completedAt ?? null,
        dismissedAt: next.dismissedAt ?? null,
      }),
    });

    return NextResponse.json({ ok: true, state: next });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PATCH /api/clients/[id]/quick-start error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
