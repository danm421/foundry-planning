import { NextRequest, NextResponse } from "next/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import {
  updateLiabilityForClient,
  deleteLiabilityForClient,
} from "@/lib/clients/liabilities-writes";

export const dynamic = "force-dynamic";

// PUT /api/clients/[id]/liabilities/[liabilityId] — update liability
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; liabilityId: string }> }
) {
  try {
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const { id, liabilityId } = await params;
    const result = await updateLiabilityForClient({
      clientId: id,
      firmId,
      actorId: userId,
      liabilityId,
      input: await request.json(),
    });
    return result.ok
      ? NextResponse.json(result.data)
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/liabilities/[liabilityId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/liabilities/[liabilityId] — delete liability
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; liabilityId: string }> }
) {
  try {
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const { id, liabilityId } = await params;
    const result = await deleteLiabilityForClient({
      clientId: id,
      firmId,
      actorId: userId,
      liabilityId,
    });
    return result.ok
      ? NextResponse.json({ success: true })
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/liabilities/[liabilityId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
