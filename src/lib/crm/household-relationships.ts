import { db } from "@/db";
import { crmHouseholds, crmHouseholdRelationships } from "@/db/schema";
import { and, eq, inArray, or } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { requireCrmHouseholdAccess } from "./authz";
import { recordAudit } from "@/lib/audit";
import { recordActivity } from "./activity";
import {
  counterpartLabel,
  toCanonicalColumns,
  type CrmHouseholdRelationshipType,
  type ViewerSide,
} from "./relationship-labels";

export class HouseholdsAlreadyLinkedError extends Error {
  constructor() { super("These households are already linked"); }
}
export class SelfLinkError extends Error {
  constructor() { super("A household cannot be linked to itself"); }
}

/** Postgres unique-violation (23505), as surfaced by the Neon driver. */
export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  return e.code === "23505" || e.cause?.code === "23505";
}

export type HouseholdRelationshipView = {
  id: string;
  type: CrmHouseholdRelationshipType;
  viewerSide: ViewerSide;
  label: string;
  note: string | null;
  sourceFamilyMemberId: string | null;
  counterpart: { id: string; name: string; status: string };
};

/**
 * All links touching the household, normalized to its perspective.
 * Counterparts in Trash are hidden — the edge survives, so restoring the
 * counterpart brings the link back.
 */
export async function listHouseholdRelationships(
  householdId: string,
): Promise<HouseholdRelationshipView[]> {
  await requireCrmHouseholdAccess(householdId);
  const edges = await db.query.crmHouseholdRelationships.findMany({
    where: or(
      eq(crmHouseholdRelationships.fromHouseholdId, householdId),
      eq(crmHouseholdRelationships.toHouseholdId, householdId),
    ),
  });
  if (edges.length === 0) return [];
  const counterpartIds = edges.map((e) =>
    e.fromHouseholdId === householdId ? e.toHouseholdId : e.fromHouseholdId,
  );
  const counterparts = await db.query.crmHouseholds.findMany({
    where: inArray(crmHouseholds.id, counterpartIds),
    columns: { id: true, name: true, status: true, deletedAt: true },
  });
  const byId = new Map(counterparts.map((h) => [h.id, h]));
  const views: HouseholdRelationshipView[] = [];
  for (const e of edges) {
    const viewerSide: ViewerSide = e.fromHouseholdId === householdId ? "from" : "to";
    const counterpart = byId.get(viewerSide === "from" ? e.toHouseholdId : e.fromHouseholdId);
    if (!counterpart || counterpart.deletedAt) continue;
    views.push({
      id: e.id,
      type: e.relationshipType,
      viewerSide,
      label: counterpartLabel(e.relationshipType, viewerSide),
      note: e.note,
      sourceFamilyMemberId: e.sourceFamilyMemberId,
      counterpart: { id: counterpart.id, name: counterpart.name, status: counterpart.status },
    });
  }
  return views;
}

export async function createHouseholdRelationship(
  householdId: string,
  input: {
    counterpartHouseholdId: string;
    type: CrmHouseholdRelationshipType;
    viewerSide: ViewerSide;
    note?: string | null;
  },
) {
  if (householdId === input.counterpartHouseholdId) throw new SelfLinkError();
  // Access check on BOTH ends doubles as the same-firm assert —
  // requireCrmHouseholdAccess scopes to the caller's org.
  const { household, orgId } = await requireCrmHouseholdAccess(householdId);
  const { household: counterpart } = await requireCrmHouseholdAccess(input.counterpartHouseholdId);
  const { userId } = await auth();
  const actorId = userId ?? "system";

  const cols = toCanonicalColumns({
    viewerSide: input.viewerSide,
    viewerHouseholdId: householdId,
    counterpartHouseholdId: input.counterpartHouseholdId,
  });

  let row: typeof crmHouseholdRelationships.$inferSelect;
  try {
    [row] = await db
      .insert(crmHouseholdRelationships)
      .values({
        firmId: orgId,
        fromHouseholdId: cols.fromHouseholdId,
        toHouseholdId: cols.toHouseholdId,
        relationshipType: input.type,
        note: input.note?.trim() || null,
        createdBy: actorId,
      })
      .returning();
  } catch (err) {
    if (isUniqueViolation(err)) throw new HouseholdsAlreadyLinkedError();
    throw err;
  }

  await recordAudit({
    action: "crm.household_relationship.create",
    resourceType: "crm_household_relationship",
    resourceId: row.id,
    firmId: orgId,
  });
  const now = new Date();
  await recordActivity(
    {
      householdId,
      kind: "relationship_change",
      title: `Linked household: ${counterpart.name} (${counterpartLabel(input.type, input.viewerSide)})`,
      metadata: { relationshipId: row.id, counterpartHouseholdId: counterpart.id },
      occurredAt: now,
    },
    { actorUserId: actorId },
  );
  await recordActivity(
    {
      householdId: counterpart.id,
      kind: "relationship_change",
      title: `Linked household: ${household.name} (${counterpartLabel(input.type, input.viewerSide === "from" ? "to" : "from")})`,
      metadata: { relationshipId: row.id, counterpartHouseholdId: household.id },
      occurredAt: now,
    },
    { actorUserId: actorId },
  );
  return row;
}

export async function deleteHouseholdRelationship(householdId: string, relationshipId: string) {
  const { orgId } = await requireCrmHouseholdAccess(householdId);
  const edge = await db.query.crmHouseholdRelationships.findFirst({
    where: and(
      eq(crmHouseholdRelationships.id, relationshipId),
      eq(crmHouseholdRelationships.firmId, orgId),
    ),
  });
  if (!edge || (edge.fromHouseholdId !== householdId && edge.toHouseholdId !== householdId)) {
    throw new Error(`CRM household relationship not found: ${relationshipId}`);
  }
  await db.delete(crmHouseholdRelationships).where(eq(crmHouseholdRelationships.id, relationshipId));
  const { userId } = await auth();
  await recordAudit({
    action: "crm.household_relationship.delete",
    resourceType: "crm_household_relationship",
    resourceId: relationshipId,
    firmId: orgId,
  });
  const otherId = edge.fromHouseholdId === householdId ? edge.toHouseholdId : edge.fromHouseholdId;
  const now = new Date();
  for (const hh of [householdId, otherId]) {
    await recordActivity(
      { householdId: hh, kind: "relationship_change", title: "Removed household link", metadata: { relationshipId }, occurredAt: now },
      { actorUserId: userId ?? "system" },
    );
  }
}
