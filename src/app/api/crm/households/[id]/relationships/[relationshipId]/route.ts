import { NextRequest, NextResponse } from "next/server";
import { deleteHouseholdRelationship, RelationshipNotFoundError } from "@/lib/crm/household-relationships";
import { UnauthorizedError } from "@/lib/db-helpers";
import { authErrorResponse, requireActiveSubscription } from "@/lib/authz";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; relationshipId: string }> },
) {
  try {
    const { id, relationshipId } = await params;
    await requireActiveSubscription();
    await deleteHouseholdRelationship(id, relationshipId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const denial = authErrorResponse(err);
    if (denial) return NextResponse.json(denial.body, { status: denial.status });
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      err instanceof RelationshipNotFoundError ||
      (err instanceof Error && err.message.startsWith("CRM household not found or access denied"))
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("DELETE /api/crm/households/[id]/relationships/[relationshipId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
