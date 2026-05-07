import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, entities, entityOwners, scenarios, accounts, accountOwners } from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { entityCreateSchema } from "@/lib/schemas/entities";
import type { TrustSubType } from "@/lib/entities/trust";

/** Derive the legacy `owner` enum from the multi-owner allocation. Used to
 *  keep the deprecated column populated for back-compat readers (balance-sheet
 *  filter, family-view). Returns null when the owners array doesn't fit a
 *  client/spouse/joint shape. */
function deriveLegacyOwner(
  ownersInput: { familyMemberId: string; percent: number }[] | undefined,
  members: { id: string; role: "client" | "spouse" | "child" | "other" }[],
): "client" | "spouse" | "joint" | null {
  if (!ownersInput || ownersInput.length === 0) return null;
  const clientId = members.find((m) => m.role === "client")?.id;
  const spouseId = members.find((m) => m.role === "spouse")?.id;
  const total = ownersInput.reduce((s, o) => s + o.percent, 0);
  if (Math.abs(total - 1) > 0.0001) return null;
  if (ownersInput.length === 1) {
    const o = ownersInput[0];
    if (o.familyMemberId === clientId) return "client";
    if (o.familyMemberId === spouseId) return "spouse";
  }
  if (ownersInput.length === 2 && clientId && spouseId) {
    const c = ownersInput.find((o) => o.familyMemberId === clientId);
    const s = ownersInput.find((o) => o.familyMemberId === spouseId);
    if (c && s && Math.abs(c.percent - 0.5) < 0.0001 && Math.abs(s.percent - 0.5) < 0.0001) {
      return "joint";
    }
  }
  return null;
}

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

    const entityIds = rows.map((r) => r.id);
    const ownerRows = entityIds.length > 0
      ? await db
          .select()
          .from(entityOwners)
          .where(inArray(entityOwners.entityId, entityIds))
      : [];
    const ownersByEntity = new Map<string, { kind: "family_member"; familyMemberId: string; percent: number }[]>();
    for (const o of ownerRows) {
      const arr = ownersByEntity.get(o.entityId) ?? [];
      arr.push({ kind: "family_member", familyMemberId: o.familyMemberId, percent: parseFloat(o.percent) });
      ownersByEntity.set(o.entityId, arr);
    }
    const enriched = rows.map((r) => ({
      ...r,
      owners: ownersByEntity.get(r.id) ?? [],
    }));
    return NextResponse.json(enriched);
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

    // Load household family members so we can validate ownership refs and
    // derive the legacy owner enum for back-compat readers.
    const householdMembers = await db.query.familyMembers.findMany({
      where: (fm, { eq }) => eq(fm.clientId, id),
      columns: { id: true, role: true },
    });
    if (data.owners && data.owners.length > 0) {
      const memberIds = new Set(householdMembers.map((m) => m.id));
      for (const o of data.owners) {
        if (!memberIds.has(o.familyMemberId)) {
          return NextResponse.json(
            { error: `owners.familyMemberId ${o.familyMemberId} does not belong to this client` },
            { status: 400 },
          );
        }
      }
      const total = data.owners.reduce((s, o) => s + o.percent, 0);
      if (Math.abs(total - 1) > 0.0001) {
        return NextResponse.json({ error: "owners percent must sum to 1.0" }, { status: 400 });
      }
    }
    const legacyOwner =
      data.entityType === "trust" || data.entityType === "foundation"
        ? null
        : (deriveLegacyOwner(data.owners, householdMembers) ?? data.owner ?? null);

    const [entity] = await db
      .insert(entities)
      .values({
        clientId: id,
        name: data.name,
        entityType: data.entityType,
        notes: data.notes ?? null,
        includeInPortfolio: data.includeInPortfolio ?? false,
        accessibleToClient: data.accessibleToClient ?? false,
        isGrantor: data.isGrantor ?? false,
        value: data.value != null ? String(data.value) : "0",
        basis: data.basis != null ? String(data.basis) : "0",
        owner: legacyOwner,
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

    // Insert entity_owners rows for business-type entities. Trusts skip this —
    // their grantor/beneficiary structure is captured in dedicated columns.
    const isBusinessType = !["trust", "foundation"].includes(data.entityType);
    if (isBusinessType && data.owners && data.owners.length > 0) {
      await db.insert(entityOwners).values(
        data.owners.map((o) => ({
          entityId: entity.id,
          familyMemberId: o.familyMemberId,
          percent: String(o.percent),
        })),
      );
    }

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

    const responseOwners = isBusinessType && data.owners
      ? data.owners.map((o) => ({
          kind: "family_member" as const,
          familyMemberId: o.familyMemberId,
          percent: o.percent,
        }))
      : [];
    return NextResponse.json({ ...entity, owners: responseOwners }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/entities error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
