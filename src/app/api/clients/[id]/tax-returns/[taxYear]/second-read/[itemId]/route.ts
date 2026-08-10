import { NextRequest, NextResponse } from "next/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { requireActiveSubscription } from "@/lib/authz";
import { verifyClientAccess } from "@/lib/clients/authz";
import { getTaxReturn } from "@/lib/tax-returns/store";
import { parseYear } from "@/lib/tax-returns/assemble-analysis";
import { dismissSecondReadItem } from "@/lib/tax-returns/second-read/store";

export const dynamic = "force-dynamic";

/**
 * Dismiss one AI second-read item. Deliberately NOT gated on `ai_import`:
 * hiding an item makes no AI call, and a firm whose entitlement lapsed must
 * still be able to clear a panel it is looking at.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; taxYear: string; itemId: string }> },
) {
  try {
    await requireOrgId();
    await requireActiveSubscription();
    const { id: clientId, taxYear: rawYear, itemId } = await params;

    const taxYear = parseYear(rawYear);
    if (taxYear == null) return NextResponse.json({ error: "Invalid tax year" }, { status: 400 });

    const access = await verifyClientAccess(clientId);
    if (!access.ok) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    if (access.access !== "own" || access.permission !== "edit") {
      return NextResponse.json({ error: "Edit access required" }, { status: 403 });
    }

    const row = await getTaxReturn(clientId, taxYear);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const secondRead = await dismissSecondReadItem(row.id, itemId);
    if (!secondRead) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json({ secondRead });
  } catch (err) {
    if (err instanceof UnauthorizedError || (err instanceof Error && err.message === "Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/tax-returns/[taxYear]/second-read/[itemId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
