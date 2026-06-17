import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scenarios, accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgAndUser } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { createAccountForClient } from "@/lib/clients/accounts-writes";

export const dynamic = "force-dynamic";

async function getBaseCaseScenarioId(clientId: string): Promise<string | null> {
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return null;

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));

  return scenario?.id ?? null;
}

// GET /api/clients/[id]/accounts — list accounts for base case scenario
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const scenarioId = await getBaseCaseScenarioId(id);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.clientId, id), eq(accounts.scenarioId, scenarioId)));

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/accounts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/accounts — create account for base case scenario
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { orgId: firmId, userId } = await requireOrgAndUser();
    const { id } = await params;

    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }

    const result = await createAccountForClient({
      clientId: id,
      firmId,
      actorId: userId,
      input: await request.json(),
    });
    return result.ok
      ? NextResponse.json(result.data, { status: 201 })
      : NextResponse.json({ error: result.error }, { status: result.status });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/accounts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
