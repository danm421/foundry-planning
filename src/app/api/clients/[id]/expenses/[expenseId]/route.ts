import { NextRequest, NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import {
  updateExpenseForClient,
  deleteExpenseForClient,
} from "@/lib/clients/expenses-writes";

export const dynamic = "force-dynamic";

// PUT /api/clients/[id]/expenses/[expenseId] — update expense
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; expenseId: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id, expenseId } = await params;
    const result = await updateExpenseForClient({
      clientId: id,
      firmId,
      actorId: firmId,
      expenseId,
      input: await request.json(),
    });
    return result.ok
      ? NextResponse.json(result.data)
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/expenses/[expenseId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/expenses/[expenseId] — delete expense
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; expenseId: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id, expenseId } = await params;
    const result = await deleteExpenseForClient({
      clientId: id,
      firmId,
      actorId: firmId,
      expenseId,
    });
    return result.ok
      ? new NextResponse(null, { status: 204 })
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/expenses/[expenseId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
