import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscription } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { mergeQuickStartState, type QuickStartState } from "@/lib/quick-start/state";
import { verifyClientAccess } from "@/lib/clients/authz";

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
    const firmId = await requireOrgId();
    await requireActiveSubscription();
    const { id } = await params;

    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }

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
      metadata: {
        lastStepVisited: next.lastStepVisited ?? null,
        completedAt: next.completedAt ?? null,
        dismissedAt: next.dismissedAt ?? null,
      },
    });

    return NextResponse.json({ ok: true, state: next });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PATCH /api/clients/[id]/quick-start error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
