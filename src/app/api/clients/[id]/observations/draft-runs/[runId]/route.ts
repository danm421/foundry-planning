import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { UnauthorizedError } from "@/lib/db-helpers";
import { requireClientAccess } from "@/lib/clients/authz";
import { getRunForHousehold } from "@/lib/crm/generation-runs";

export const dynamic = "force-dynamic";

const RUN_KIND = "observations-draft";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  try {
    const { id, runId } = await params;

    // Not-found and access-denied both read as a plain 404 here (mirrors
    // /clients/[id]/generation-runs) so existence never leaks across firms.
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

    // Guard before the query — a malformed uuid would throw at the pg layer.
    if (!z.string().uuid().safeParse(runId).success) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const run = await getRunForHousehold(runId, householdId, firmId);
    // Scope to this endpoint's own run kind — a household can also have
    // presentation / meeting-prep runs sharing the same (householdId, firmId).
    if (!run || run.kind !== RUN_KIND) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(
      {
        status: run.status,
        error: run.error,
        suggestions:
          (run.resultPayload as { suggestions?: unknown } | null)?.suggestions ?? null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    if (err instanceof UnauthorizedError || (err instanceof Error && err.name === "UnauthorizedError")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /clients/[id]/observations/draft-runs/[runId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
