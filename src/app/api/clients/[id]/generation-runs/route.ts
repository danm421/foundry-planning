import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { listRecentRuns } from "@/lib/crm/generation-runs";

export const dynamic = "force-dynamic";

const LIMIT = 25;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const [client] = await db
      .select({ householdId: clients.crmHouseholdId })
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)))
      .limit(1);
    if (!client?.householdId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const runs = await listRecentRuns(client.householdId, firmId, LIMIT);
    return NextResponse.json(
      { householdId: client.householdId, runs },
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
