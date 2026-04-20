import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, entities, scenarios, accounts } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

async function verifyClient(clientId: string, firmId: string) {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!client;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const rows = await db
      .select()
      .from(entities)
      .where(eq(entities.clientId, id))
      .orderBy(asc(entities.name));
    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/entities error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const {
      name,
      entityType,
      notes,
      includeInPortfolio,
      isGrantor,
      value,
      owner,
      grantors,
      beneficiaries,
    } = body;
    if (!name) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const [entity] = await db
      .insert(entities)
      .values({
        clientId: id,
        name,
        entityType: entityType ?? "trust",
        notes: notes ?? null,
        includeInPortfolio: includeInPortfolio ?? false,
        isGrantor: isGrantor ?? false,
        value: value != null ? String(value) : "0",
        owner: owner ?? null,
        grantors: grantors ?? null,
        beneficiaries: beneficiaries ?? null,
      })
      .returning();

    // Create a default checking account for this entity in every one of the client's
    // scenarios so the projection engine can route the entity's incomes/expenses/RMDs
    // through a dedicated cash bucket.
    const scenarioRows = await db
      .select({ id: scenarios.id })
      .from(scenarios)
      .where(eq(scenarios.clientId, id));

    if (scenarioRows.length > 0) {
      await db.insert(accounts).values(
        scenarioRows.map((s) => ({
          clientId: id,
          scenarioId: s.id,
          name: `${entity.name} — Cash`,
          category: "cash" as const,
          subType: "checking" as const,
          owner: "joint" as const,
          value: "0",
          basis: "0",
          growthRate: null,
          rmdEnabled: false,
          isDefaultChecking: true,
          ownerEntityId: entity.id,
        }))
      );
    }

    await recordAudit({
      action: "entity.create",
      resourceType: "entity",
      resourceId: entity.id,
      clientId: id,
      firmId,
      metadata: { name: entity.name, entityType: entity.entityType },
    });

    return NextResponse.json(entity, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/entities error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
