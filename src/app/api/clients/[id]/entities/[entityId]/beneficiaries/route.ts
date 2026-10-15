import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { beneficiaryDesignations } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import {
  replaceTrustBeneficiariesForClient,
  verifyClientAndTrust,
} from "@/lib/clients/beneficiary-designations-writes";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; entityId: string }> },
) {
  try {
    const { id, entityId } = await params;
    const v = await verifyClientAndTrust(id, entityId);
    if (!v.ok)
      return NextResponse.json(
        { error: v.reason === "not_trust" ? "Entity is not a trust" : "Not found" },
        { status: v.reason === "not_trust" ? 400 : 404 },
      );
    const rows = await db
      .select()
      .from(beneficiaryDesignations)
      .where(
        and(
          eq(beneficiaryDesignations.clientId, id),
          eq(beneficiaryDesignations.targetKind, "trust"),
          eq(beneficiaryDesignations.entityId, entityId),
        ),
      )
      .orderBy(asc(beneficiaryDesignations.tier), asc(beneficiaryDesignations.sortOrder));
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET trust beneficiaries error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; entityId: string }> },
) {
  try {
    const { id, entityId } = await params;
    const { firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const v = await verifyClientAndTrust(id, entityId);
    if (!v.ok)
      return NextResponse.json(
        { error: v.reason === "not_trust" ? "Entity is not a trust" : "Not found" },
        { status: v.reason === "not_trust" ? 400 : 404 },
      );
    const result = await replaceTrustBeneficiariesForClient({
      clientId: id,
      firmId,
      entityId,
      input: await request.json(),
    });
    if (!result.ok) {
      return NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT trust beneficiaries error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
