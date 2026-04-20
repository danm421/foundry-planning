import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, planSettings } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { computePlanEndAge } from "@/lib/plan-horizon";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// GET /api/clients/[id] — get single client
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    if (!client) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(client);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/clients/[id] — update client
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;
    const body = await request.json();

    const [existing] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Re-derive planEndAge whenever any input to the horizon calc changes.
    const updateBody = { ...body };
    const dobChanged = "dateOfBirth" in body;
    const leChanged = "lifeExpectancy" in body;
    const spouseDobChanged = "spouseDob" in body;
    const spouseLeChanged = "spouseLifeExpectancy" in body;
    if (dobChanged || leChanged || spouseDobChanged || spouseLeChanged) {
      updateBody.planEndAge = computePlanEndAge({
        clientDob: body.dateOfBirth ?? existing.dateOfBirth,
        clientLifeExpectancy: Number(body.lifeExpectancy ?? existing.lifeExpectancy),
        spouseDob:
          spouseDobChanged ? body.spouseDob ?? null : existing.spouseDob ?? null,
        spouseLifeExpectancy:
          spouseLeChanged
            ? body.spouseLifeExpectancy != null
              ? Number(body.spouseLifeExpectancy)
              : null
            : existing.spouseLifeExpectancy ?? null,
      });
    }

    // Strip identity / ownership fields from the update payload so a client
     // can't be reparented across firms or its id rewritten via request body.
    const {
      id: _stripId,
      firmId: _stripFirmId,
      advisorId: _stripAdvisorId,
      createdAt: _stripCreatedAt,
      updatedAt: _stripUpdatedAt,
      ...safeUpdate
    } = updateBody;
    void _stripId; void _stripFirmId; void _stripAdvisorId;
    void _stripCreatedAt; void _stripUpdatedAt;

    const [updated] = await db
      .update(clients)
      .set({
        ...safeUpdate,
        updatedAt: new Date(),
      })
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)))
      .returning();

    // If the horizon moved, push the new planEndYear through to all the
    // client's scenarios so the engine and UI stay in sync without the
    // advisor having to re-save plan settings.
    if (updateBody.planEndAge != null) {
      const newEndYear =
        new Date(updated.dateOfBirth).getFullYear() + updateBody.planEndAge;
      await db
        .update(planSettings)
        .set({ planEndYear: newEndYear, updatedAt: new Date() })
        .where(eq(planSettings.clientId, id));
    }

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id] — delete client
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const [existing] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db
      .delete(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    await recordAudit({
      action: "client.delete",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId,
      metadata: {
        firstName: existing.firstName,
        lastName: existing.lastName,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
