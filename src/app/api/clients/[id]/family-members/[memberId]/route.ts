import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, familyMembers } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

async function verifyClient(clientId: string, firmId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!client;
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id, memberId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const {
      firstName, lastName, relationship, dateOfBirth, notes,
      domesticPartner, inheritanceClassOverride,
    } = body;

    const [updated] = await db
      .update(familyMembers)
      .set({
        ...(firstName !== undefined && { firstName }),
        ...(lastName !== undefined && { lastName: lastName ?? null }),
        ...(relationship !== undefined && { relationship }),
        ...(dateOfBirth !== undefined && { dateOfBirth: dateOfBirth || null }),
        ...(notes !== undefined && { notes: notes ?? null }),
        ...(domesticPartner !== undefined && { domesticPartner: !!domesticPartner }),
        ...(inheritanceClassOverride !== undefined && { inheritanceClassOverride }),
        updatedAt: new Date(),
      })
      .where(and(eq(familyMembers.id, memberId), eq(familyMembers.clientId, id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Family member not found" }, { status: 404 });
    }

    await recordAudit({
      action: "family_member.update",
      resourceType: "family_member",
      resourceId: memberId,
      clientId: id,
      firmId,
      metadata: { firstName: updated.firstName, relationship: updated.relationship },
    });

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/family-members/[memberId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id, memberId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    await db
      .delete(familyMembers)
      .where(and(eq(familyMembers.id, memberId), eq(familyMembers.clientId, id)));

    await recordAudit({
      action: "family_member.delete",
      resourceType: "family_member",
      resourceId: memberId,
      clientId: id,
      firmId,
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/family-members/[memberId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
