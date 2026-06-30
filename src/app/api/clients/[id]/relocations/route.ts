import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scenarios, relocations } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordCreate, recordUpdate, recordDelete } from "@/lib/audit";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import { isUSPSStateCode } from "@/lib/usps-states";
import type { EntitySnapshot, FieldLabels } from "@/lib/audit/types";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getBaseCaseScenarioId(clientId: string): Promise<string | null> {
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return null;

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));

  return scenario?.id ?? null;
}

const RELOCATION_FIELD_LABELS: FieldLabels = {
  name: { label: "Name", format: "text" },
  year: { label: "Year", format: "text" },
  destinationState: { label: "Destination state", format: "text" },
};

type RelocationRow = typeof relocations.$inferSelect;

function toRelocationSnapshot(row: RelocationRow): EntitySnapshot {
  return {
    name: row.name,
    year: row.year,
    destinationState: row.destinationState,
  };
}

function validateBody(body: {
  name?: unknown;
  year?: unknown;
  destinationState?: unknown;
}): { ok: true; name: string; year: number; destinationState: string } | { ok: false; message: string } {
  const { name, year, destinationState } = body;

  if (!name || typeof name !== "string" || name.trim() === "") {
    return { ok: false, message: "name must be a non-empty string" };
  }
  if (typeof year !== "number" || !Number.isInteger(year) || year < 1900 || year > 2200) {
    return { ok: false, message: "year must be an integer between 1900 and 2200" };
  }
  if (!isUSPSStateCode(destinationState)) {
    return { ok: false, message: "destinationState must be a valid US state code" };
  }

  return { ok: true, name: name.trim(), year, destinationState };
}

// ---------------------------------------------------------------------------
// GET /api/clients/[id]/relocations — list for base-case scenario
// ---------------------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
      .from(relocations)
      .where(and(eq(relocations.clientId, id), eq(relocations.scenarioId, scenarioId)));

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/relocations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/clients/[id]/relocations — create relocation for base-case scenario
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const scenarioId = await getBaseCaseScenarioId(id);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const validation = validateBody(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.message }, { status: 400 });
    }
    const { name, year, destinationState } = validation;

    const [created] = await db
      .insert(relocations)
      .values({ clientId: id, scenarioId, name, year, destinationState })
      .returning();

    await recordCreate({
      action: "relocation.create",
      resourceType: "relocation",
      resourceId: created.id,
      clientId: id,
      firmId,
      snapshot: toRelocationSnapshot(created),
      extraMetadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/relocations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/clients/[id]/relocations — update by relocationId (in body)
// ---------------------------------------------------------------------------
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const body = await request.json();
    const { relocationId, ...fields } = body;

    if (!relocationId) {
      return NextResponse.json({ error: "Missing relocationId" }, { status: 400 });
    }

    const validation = validateBody(fields);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.message }, { status: 400 });
    }
    const { name, year, destinationState } = validation;

    const [before] = await db
      .select()
      .from(relocations)
      .where(and(eq(relocations.id, relocationId), eq(relocations.clientId, id)));

    if (!before) {
      return NextResponse.json({ error: "Relocation not found" }, { status: 404 });
    }

    const [updated] = await db
      .update(relocations)
      .set({ name, year, destinationState, updatedAt: new Date() })
      .where(and(eq(relocations.id, relocationId), eq(relocations.clientId, id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Relocation not found" }, { status: 404 });
    }

    await recordUpdate({
      action: "relocation.update",
      resourceType: "relocation",
      resourceId: relocationId,
      clientId: id,
      firmId,
      before: toRelocationSnapshot(before),
      after: toRelocationSnapshot(updated),
      fieldLabels: RELOCATION_FIELD_LABELS,
      extraMetadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return NextResponse.json(updated);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/clients/[id]/relocations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/clients/[id]/relocations — delete by relocationId (query param)
// ---------------------------------------------------------------------------
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const { searchParams } = new URL(request.url);
    const relocationId = searchParams.get("relocationId");

    if (!relocationId) {
      return NextResponse.json({ error: "Missing relocationId" }, { status: 400 });
    }

    const [existing] = await db
      .select()
      .from(relocations)
      .where(and(eq(relocations.id, relocationId), eq(relocations.clientId, id)));

    if (!existing) {
      return NextResponse.json({ error: "Relocation not found" }, { status: 404 });
    }

    const snapshot = toRelocationSnapshot(existing);

    await db
      .delete(relocations)
      .where(and(eq(relocations.id, relocationId), eq(relocations.clientId, id)));

    await recordDelete({
      action: "relocation.delete",
      resourceType: "relocation",
      resourceId: relocationId,
      clientId: id,
      firmId,
      snapshot,
      extraMetadata: crossFirmAuditMeta({ access }, callerOrg),
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/clients/[id]/relocations error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
