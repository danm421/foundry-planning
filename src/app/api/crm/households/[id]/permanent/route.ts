import { NextRequest, NextResponse } from "next/server";
import { requireOrgAdminOrOwner, authErrorResponse } from "@/lib/authz";
import { purgeCrmHousehold } from "@/lib/crm/households";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireOrgAdminOrOwner();
    const { id } = await params;
    await purgeCrmHousehold(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const authErr = authErrorResponse(err);
    if (authErr) return NextResponse.json(authErr.body, { status: authErr.status });
    if (err instanceof Error && err.message === "Household not found") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("DELETE /api/crm/households/[id]/permanent error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
