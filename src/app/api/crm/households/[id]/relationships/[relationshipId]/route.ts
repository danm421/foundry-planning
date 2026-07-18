import { NextRequest, NextResponse } from "next/server";
import { deleteHouseholdRelationship } from "@/lib/crm/household-relationships";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; relationshipId: string }> },
) {
  try {
    const { id, relationshipId } = await params;
    await deleteHouseholdRelationship(id, relationshipId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (
      err instanceof Error &&
      (err.message.startsWith("CRM household not found or access denied") ||
        err.message.startsWith("CRM household relationship not found"))
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("DELETE /api/crm/households/[id]/relationships/[relationshipId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
