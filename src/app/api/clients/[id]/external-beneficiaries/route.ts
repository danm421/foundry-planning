import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import { externalBeneficiaries } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { externalBeneficiaryCreateSchema } from "@/lib/schemas/beneficiaries";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const rows = await db
      .select()
      .from(externalBeneficiaries)
      .where(eq(externalBeneficiaries.clientId, id))
      .orderBy(asc(externalBeneficiaries.name));
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/external-beneficiaries error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireOrgAndUser();
    const { id } = await params;
    const { firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const body = await request.json();
    const parsed = externalBeneficiaryCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: formatZodIssues(parsed.error) },
        { status: 400 },
      );
    }
    const [row] = await db
      .insert(externalBeneficiaries)
      .values({
        clientId: id,
        name: parsed.data.name,
        kind: parsed.data.kind,
        charityType: parsed.data.charityType,
        notes: parsed.data.notes ?? null,
      })
      .returning();
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/external-beneficiaries error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
