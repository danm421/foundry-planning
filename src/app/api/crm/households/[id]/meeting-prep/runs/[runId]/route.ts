import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCrmHouseholdAccess } from "@/lib/crm/authz";
import { authErrorResponse } from "@/lib/authz";
import { getRunForHousehold } from "@/lib/crm/generation-runs";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  try {
    const { id, runId } = await params;
    const { orgId } = await requireCrmHouseholdAccess(id);
    // Guard before the query — a malformed uuid would throw at the pg layer.
    if (!z.string().uuid().safeParse(runId).success) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const run = await getRunForHousehold(runId, id, orgId);
    if (!run) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(
      { run },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.startsWith("CRM household not found or access denied")
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET meeting-prep/runs/[runId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
