import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { assetClasses } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { isAssetTypeId } from "@/lib/investments/asset-types";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;
    const body = await request.json();

    if (body.assetType !== undefined && !isAssetTypeId(body.assetType)) {
      return NextResponse.json({ error: "Invalid assetType" }, { status: 400 });
    }

    // Prevent mass-assignment: strip identity / tenancy fields so the
     // row can't be reparented or its id rewritten via request body.
    const {
      id: _stripId,
      firmId: _stripFirmId,
      createdAt: _stripCreatedAt,
      updatedAt: _stripUpdatedAt,
      ...safeUpdate
    } = body;
    void _stripId; void _stripFirmId;
    void _stripCreatedAt; void _stripUpdatedAt;

    const [updated] = await db
      .update(assetClasses)
      .set({ ...safeUpdate, updatedAt: new Date() })
      .where(and(eq(assetClasses.id, id), eq(assetClasses.firmId, firmId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/cma/asset-classes/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;

    await db
      .delete(assetClasses)
      .where(and(eq(assetClasses.id, id), eq(assetClasses.firmId, firmId)));

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/cma/asset-classes/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
