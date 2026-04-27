import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, entities, scenarios, accounts, accountOwners } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { entityCreateSchema } from "@/lib/schemas/entities";
import type { TrustSubType } from "@/lib/entities/trust";

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
    const parsed = entityCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const data = parsed.data;

    const [entity] = await db
      .insert(entities)
      .values({
        clientId: id,
        name: data.name,
        entityType: data.entityType,
        notes: data.notes ?? null,
        includeInPortfolio: data.includeInPortfolio ?? false,
        isGrantor: data.isGrantor ?? false,
        value: data.value != null ? String(data.value) : "0",
        owner: data.owner ?? null,
        grantor: data.grantor ?? null,
        beneficiaries: data.beneficiaries ?? null,
        trustSubType:
          data.entityType === "trust"
            ? ((data.trustSubType ?? null) as TrustSubType | null)
            : null,
        isIrrevocable:
          data.entityType === "trust" ? data.isIrrevocable ?? null : null,
        trustee: data.entityType === "trust" ? data.trustee ?? null : null,
        trustEnds: data.entityType === "trust" ? (data.trustEnds ?? null) : null,
        distributionMode:
          data.entityType === "trust"
            ? (data.distributionMode ?? null)
            : null,
        distributionAmount:
          data.entityType === "trust" && data.distributionAmount != null
            ? String(data.distributionAmount)
            : null,
        distributionPercent:
          data.entityType === "trust" && data.distributionPercent != null
            ? String(data.distributionPercent)
            : null,
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
      // Insert one entity-checking account per scenario, then wire ownership via
      // the account_owners junction table (no legacy owner/ownerEntityId columns).
      const insertedAccounts = await db.insert(accounts).values(
        scenarioRows.map((s) => ({
          clientId: id,
          scenarioId: s.id,
          name: `${entity.name} — Cash`,
          category: "cash" as const,
          subType: "checking" as const,
          value: "0",
          basis: "0",
          growthRate: null,
          rmdEnabled: false,
          isDefaultChecking: true,
        }))
      ).returning({ id: accounts.id });

      // Create accountOwners rows linking each new account to this entity.
      if (insertedAccounts.length > 0) {
        await db.insert(accountOwners).values(
          insertedAccounts.map((a) => ({
            accountId: a.id,
            entityId: entity.id,
            familyMemberId: null,
            percent: "1.0000",
          }))
        );
      }
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
