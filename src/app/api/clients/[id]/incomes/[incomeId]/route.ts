import { NextRequest, NextResponse } from "next/server";
import { requireOrgAndUser } from "@/lib/db-helpers";
import {
  updateIncomeForClient,
  deleteIncomeForClient,
} from "@/lib/clients/incomes-writes";

export const dynamic = "force-dynamic";

// PUT /api/clients/[id]/incomes/[incomeId] — update income
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; incomeId: string }> }
) {
  try {
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const { id, incomeId } = await params;
    const result = await updateIncomeForClient({
      clientId: id,
      firmId,
      actorId: userId,
      incomeId,
      input: await request.json(),
    });
    return result.ok
      ? NextResponse.json(result.data)
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/incomes/[incomeId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/incomes/[incomeId] — delete income
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; incomeId: string }> }
) {
  try {
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const { id, incomeId } = await params;
    const result = await deleteIncomeForClient({
      clientId: id,
      firmId,
      actorId: userId,
      incomeId,
    });
    return result.ok
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/incomes/[incomeId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
