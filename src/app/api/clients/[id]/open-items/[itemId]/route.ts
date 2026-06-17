import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clientOpenItems } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/schemas/common";
import { openItemUpdateSchema } from "@/lib/schemas/open-items";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { id, itemId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const parsed = await parseBody(openItemUpdateSchema, request);
    if (!parsed.ok) return parsed.response;

    const wasCompletion =
      parsed.data.completedAt !== undefined && parsed.data.completedAt !== null;

    const [row] = await db
      .update(clientOpenItems)
      .set({
        ...(parsed.data.title !== undefined && { title: parsed.data.title }),
        ...(parsed.data.priority !== undefined && { priority: parsed.data.priority }),
        ...(parsed.data.dueDate !== undefined && { dueDate: parsed.data.dueDate }),
        ...(parsed.data.completedAt !== undefined && {
          completedAt: parsed.data.completedAt
            ? new Date(parsed.data.completedAt)
            : null,
        }),
        updatedAt: new Date(),
      })
      .where(and(eq(clientOpenItems.id, itemId), eq(clientOpenItems.clientId, id)))
      .returning();

    if (!row) {
      return NextResponse.json({ error: "Open item not found" }, { status: 404 });
    }

    await recordAudit({
      action: wasCompletion ? "open_item.complete" : "open_item.update",
      resourceType: "open_item",
      resourceId: row.id,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return NextResponse.json(row);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PATCH /api/clients/[id]/open-items/[itemId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  try {
    const { id, itemId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const [row] = await db
      .delete(clientOpenItems)
      .where(and(eq(clientOpenItems.id, itemId), eq(clientOpenItems.clientId, id)))
      .returning();

    if (!row) {
      return NextResponse.json({ error: "Open item not found" }, { status: 404 });
    }

    await recordAudit({
      action: "open_item.delete",
      resourceType: "open_item",
      resourceId: row.id,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id]/open-items/[itemId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
