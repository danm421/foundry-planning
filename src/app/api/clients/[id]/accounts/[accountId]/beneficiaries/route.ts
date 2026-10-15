import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { beneficiaryDesignations } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import {
  replaceAccountBeneficiariesForClient,
  verifyClientAndAccount,
} from "@/lib/clients/beneficiary-designations-writes";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const { id, accountId } = await params;
    if (!(await verifyClientAndAccount(id, accountId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const rows = await db
      .select()
      .from(beneficiaryDesignations)
      .where(
        and(
          eq(beneficiaryDesignations.clientId, id),
          eq(beneficiaryDesignations.targetKind, "account"),
          eq(beneficiaryDesignations.accountId, accountId),
        ),
      )
      .orderBy(asc(beneficiaryDesignations.tier), asc(beneficiaryDesignations.sortOrder));
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET account beneficiaries error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const { id, accountId } = await params;
    await requireOrgId();
    const { firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    if (!(await verifyClientAndAccount(id, accountId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const result = await replaceAccountBeneficiariesForClient({
      clientId: id,
      firmId,
      accountId,
      input: await request.json(),
    });
    if (!result.ok) {
      return NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
    }
    return NextResponse.json(result.data);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT account beneficiaries error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
