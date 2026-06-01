import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { recordHouseholdOpen } from "@/lib/crm/households";

export const dynamic = "force-dynamic";

/**
 * Records that the current user opened this household (clicked CRM/Planning
 * from the clients list). Fire-and-forget from the UI — kept lightweight and
 * idempotent (upsert of the open timestamp).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    await recordHouseholdOpen(id, userId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Failed to record open" }, { status: 400 });
  }
}
