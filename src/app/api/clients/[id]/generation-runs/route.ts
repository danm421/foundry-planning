import { NextRequest, NextResponse } from "next/server";
import { UnauthorizedError } from "@/lib/db-helpers";
import { listRecentRuns } from "@/lib/crm/generation-runs";
import { requireClientAccess } from "@/lib/clients/authz";

export const dynamic = "force-dynamic";

const LIMIT = 25;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const access = await requireClientAccess(id).catch((e) => {
      if (e instanceof UnauthorizedError) throw e;
      return null;
    });
    if (!access) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const { client, firmId } = access;
    const householdId = client.crmHouseholdId;
    if (!householdId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Meeting-prep runs have their own panel on the meeting-prep page.
    const runs = await listRecentRuns(householdId, firmId, LIMIT, {
      excludeKinds: ["meeting-prep"],
    });
    return NextResponse.json(
      { householdId, runs },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof UnauthorizedError || (err instanceof Error && err.name === "UnauthorizedError")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /clients/[id]/generation-runs failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
