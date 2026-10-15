import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { notesReceivable, scenarios } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { createNoteReceivableForClient, noteCreateRefusal } from "@/lib/clients/notes-receivable-writes";

export const dynamic = "force-dynamic";

async function getBaseCaseScenarioId(
  clientId: string,
): Promise<string | null> {
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return null;
  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(
      and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)),
    );
  return scenario?.id ?? null;
}

// GET /api/clients/[id]/notes-receivable — list for base case scenario
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireOrgId();
    const { id } = await params;

    const scenarioId = await getBaseCaseScenarioId(id);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(notesReceivable)
      .where(
        and(
          eq(notesReceivable.clientId, id),
          eq(notesReceivable.scenarioId, scenarioId),
        ),
      );

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/notes-receivable error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/notes-receivable — create note
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const refusal = await noteCreateRefusal(id, firmId);
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status });

    const result = await createNoteReceivableForClient({
      clientId: id,
      firmId,
      input: await request.json(),
      crossFirmMeta: crossFirmAuditMeta({ access }, callerOrg),
    });
    return result.ok
      ? NextResponse.json(result.data, { status: 201 })
      : NextResponse.json(result.body ?? { error: result.error }, { status: result.status });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/notes-receivable error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
