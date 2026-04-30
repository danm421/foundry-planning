import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { assetClasses } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { isAssetTypeId } from "@/lib/investments/asset-types";
import { parseBody } from "@/lib/schemas/common";
import { assetClassPutSchema } from "@/lib/schemas/asset-classes";
import { authErrorResponse, requireOrgAdminOrOwner } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();
    const { id } = await params;

    const parsed = await parseBody(assetClassPutSchema, request);
    if (!parsed.ok) return parsed.response;
    const safeUpdate = parsed.data;

    if (safeUpdate.assetType !== undefined && !isAssetTypeId(safeUpdate.assetType)) {
      return NextResponse.json({ error: "Invalid assetType" }, { status: 400 });
    }

    const [updated] = await db
      .update(assetClasses)
      .set({
        ...safeUpdate,
        // numeric columns are stored as decimal strings
        geometricReturn:
          safeUpdate.geometricReturn !== undefined
            ? String(safeUpdate.geometricReturn)
            : undefined,
        arithmeticMean:
          safeUpdate.arithmeticMean !== undefined
            ? String(safeUpdate.arithmeticMean)
            : undefined,
        volatility:
          safeUpdate.volatility !== undefined ? String(safeUpdate.volatility) : undefined,
        pctOrdinaryIncome:
          safeUpdate.pctOrdinaryIncome !== undefined
            ? String(safeUpdate.pctOrdinaryIncome)
            : undefined,
        pctLtCapitalGains:
          safeUpdate.pctLtCapitalGains !== undefined
            ? String(safeUpdate.pctLtCapitalGains)
            : undefined,
        pctQualifiedDividends:
          safeUpdate.pctQualifiedDividends !== undefined
            ? String(safeUpdate.pctQualifiedDividends)
            : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(assetClasses.id, id), eq(assetClasses.firmId, firmId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await recordAudit({
      action: "cma.asset_class.update",
      resourceType: "cma.asset_class",
      resourceId: id,
      firmId,
      metadata: { name: updated.name },
    });

    return NextResponse.json(updated);
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("PUT /api/cma/asset-classes/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireOrgAdminOrOwner();
    const firmId = await requireOrgId();
    const { id } = await params;

    await db
      .delete(assetClasses)
      .where(and(eq(assetClasses.id, id), eq(assetClasses.firmId, firmId)));

    await recordAudit({
      action: "cma.asset_class.delete",
      resourceType: "asset_class",
      resourceId: id,
      firmId,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("DELETE /api/cma/asset-classes/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
