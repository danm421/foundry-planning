import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  clients,
  entities,
  scenarios,
  entityFlowOverrides,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { flowOverrideBulkSchema } from "@/lib/schemas/flow-overrides";

export const dynamic = "force-dynamic";

async function authorize(clientId: string, entityId: string) {
  const firmId = await requireOrgId();
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  if (!client) return { error: "Client not found", status: 404 as const };
  const [ent] = await db
    .select()
    .from(entities)
    .where(and(eq(entities.id, entityId), eq(entities.clientId, clientId)));
  if (!ent) return { error: "Entity not found", status: 404 as const };
  return { firmId, ent };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entityId: string }> },
) {
  try {
    const { id, entityId } = await params;
    const scenarioId = req.nextUrl.searchParams.get("scenarioId");
    if (!scenarioId) {
      return NextResponse.json({ error: "scenarioId required" }, { status: 400 });
    }
    const auth = await authorize(id, entityId);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const [scenario] = await db
      .select()
      .from(scenarios)
      .where(and(eq(scenarios.id, scenarioId), eq(scenarios.clientId, id)));
    if (!scenario) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    const rows = await db
      .select({
        year: entityFlowOverrides.year,
        incomeAmount: entityFlowOverrides.incomeAmount,
        expenseAmount: entityFlowOverrides.expenseAmount,
        distributionPercent: entityFlowOverrides.distributionPercent,
      })
      .from(entityFlowOverrides)
      .where(
        and(
          eq(entityFlowOverrides.entityId, entityId),
          eq(entityFlowOverrides.scenarioId, scenarioId),
        ),
      );

    return NextResponse.json({
      overrides: rows.map((r) => ({
        year: r.year,
        incomeAmount: r.incomeAmount != null ? parseFloat(r.incomeAmount) : null,
        expenseAmount: r.expenseAmount != null ? parseFloat(r.expenseAmount) : null,
        distributionPercent:
          r.distributionPercent != null ? parseFloat(r.distributionPercent) : null,
      })),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/entities/[entityId]/flow-overrides error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; entityId: string }> },
) {
  try {
    const { id, entityId } = await params;
    const scenarioId = req.nextUrl.searchParams.get("scenarioId");
    if (!scenarioId) {
      return NextResponse.json({ error: "scenarioId required" }, { status: 400 });
    }
    const auth = await authorize(id, entityId);
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
    const [scenario] = await db
      .select()
      .from(scenarios)
      .where(and(eq(scenarios.id, scenarioId), eq(scenarios.clientId, id)));
    if (!scenario) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = flowOverrideBulkSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    // Whole-grid replace in a transaction.
    await db.transaction(async (tx) => {
      await tx
        .delete(entityFlowOverrides)
        .where(
          and(
            eq(entityFlowOverrides.entityId, entityId),
            eq(entityFlowOverrides.scenarioId, scenarioId),
          ),
        );
      if (parsed.data.overrides.length > 0) {
        await tx.insert(entityFlowOverrides).values(
          parsed.data.overrides.map((o) => ({
            entityId,
            scenarioId,
            year: o.year,
            incomeAmount: o.incomeAmount != null ? String(o.incomeAmount) : null,
            expenseAmount: o.expenseAmount != null ? String(o.expenseAmount) : null,
            distributionPercent:
              o.distributionPercent != null ? String(o.distributionPercent) : null,
          })),
        );
      }
    });

    await recordAudit({
      action: "entity_flow_overrides.replace",
      resourceType: "entity_flow_overrides",
      resourceId: entityId,
      clientId: id,
      firmId: auth.firmId,
      metadata: { scenarioId, count: parsed.data.overrides.length },
    });

    return NextResponse.json({ ok: true, count: parsed.data.overrides.length });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/entities/[entityId]/flow-overrides error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
