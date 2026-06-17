import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { familyMembers } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const rows = await db
      .select()
      .from(familyMembers)
      .where(eq(familyMembers.clientId, id))
      .orderBy(asc(familyMembers.relationship), asc(familyMembers.firstName));
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/family-members error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { orgId: callerOrg } = await requireOrgAndUser();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const body = await request.json();
    const {
      firstName, lastName, relationship, dateOfBirth, notes,
      domesticPartner, inheritanceClassOverride,
    } = body;
    if (!firstName) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const [member] = await db
      .insert(familyMembers)
      .values({
        clientId: id,
        firstName,
        lastName: lastName ?? null,
        relationship: relationship ?? "child",
        dateOfBirth: dateOfBirth || null,
        notes: notes ?? null,
        domesticPartner: !!domesticPartner,
        inheritanceClassOverride: inheritanceClassOverride ?? {},
      })
      .returning();

    await recordAudit({
      action: "family_member.create",
      resourceType: "family_member",
      resourceId: member.id,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { firstName: member.firstName, relationship: member.relationship }),
    });

    return NextResponse.json(member, { status: 201 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/family-members error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
