import { db } from "@/db";
import {
  accounts,
  crmHouseholds,
  crmHouseholdContacts,
  crmHouseholdViews,
  scenarios,
} from "@/db/schema";
import { and, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { requireCrmHouseholdAccess } from "./authz";
import { recordAudit } from "@/lib/audit";
import { recordActivity } from "./activity";
import type { CreateCrmHouseholdInput } from "./schemas";

type CrmHouseholdStatus = "prospect" | "active" | "inactive" | "archived";

export async function listCrmHouseholds(opts?: {
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  const firmId = await requireOrgId();
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const conditions = [eq(crmHouseholds.firmId, firmId)];
  if (opts?.status) {
    conditions.push(eq(crmHouseholds.status, opts.status as CrmHouseholdStatus));
  }
  if (opts?.search) conditions.push(ilike(crmHouseholds.name, `%${opts.search}%`));

  return db.query.crmHouseholds.findMany({
    where: and(...conditions),
    with: {
      contacts: true,
      planningClient: { columns: { id: true } },
    },
    limit,
    offset,
    orderBy: (t, { desc }) => [desc(t.updatedAt)],
  });
}

/**
 * Households the given user has opened (clicked CRM/Planning) from the
 * clients list, newest-open first. Optionally narrowed by status/search.
 * Each row carries `lastOpenedAt` for display. Returns [] when the user has
 * opened nothing yet.
 */
export async function listRecentlyOpenedHouseholds(opts: {
  userId: string;
  search?: string;
  status?: string;
  limit?: number;
}) {
  const firmId = await requireOrgId();
  const limit = opts.limit ?? 50;

  const views = await db
    .select({
      householdId: crmHouseholdViews.householdId,
      openedAt: crmHouseholdViews.openedAt,
    })
    .from(crmHouseholdViews)
    .where(
      and(
        eq(crmHouseholdViews.firmId, firmId),
        eq(crmHouseholdViews.userId, opts.userId),
      ),
    )
    .orderBy(desc(crmHouseholdViews.openedAt))
    .limit(limit);

  if (views.length === 0) return [];

  const ids = views.map((v) => v.householdId);
  const conditions = [
    eq(crmHouseholds.firmId, firmId),
    inArray(crmHouseholds.id, ids),
  ];
  if (opts.status) {
    conditions.push(eq(crmHouseholds.status, opts.status as CrmHouseholdStatus));
  }
  if (opts.search) {
    conditions.push(ilike(crmHouseholds.name, `%${opts.search}%`));
  }

  const rows = await db.query.crmHouseholds.findMany({
    where: and(...conditions),
    with: {
      contacts: true,
      planningClient: { columns: { id: true } },
    },
  });

  // Preserve the opened-at ordering and attach the timestamp.
  const rank = new Map(ids.map((id, i) => [id, i]));
  const openedAt = new Map(views.map((v) => [v.householdId, v.openedAt]));
  return rows
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
    .map((h) => ({ ...h, lastOpenedAt: openedAt.get(h.id) ?? null }));
}

/**
 * Upsert the current user's "opened" timestamp for a household. Access-checked
 * and firm-scoped via {@link requireCrmHouseholdAccess}. Fire-and-forget from
 * the UI — failures are non-fatal to navigation.
 */
export async function recordHouseholdOpen(householdId: string, userId: string) {
  const { orgId } = await requireCrmHouseholdAccess(householdId);
  await db
    .insert(crmHouseholdViews)
    .values({ householdId, firmId: orgId, userId })
    .onConflictDoUpdate({
      target: [crmHouseholdViews.userId, crmHouseholdViews.householdId],
      set: { openedAt: sql`now()` },
    });
}

export async function getCrmHousehold(id: string) {
  const firmId = await requireOrgId();
  const household = await db.query.crmHouseholds.findFirst({
    where: and(eq(crmHouseholds.id, id), eq(crmHouseholds.firmId, firmId)),
    with: {
      contacts: true,
      documents: true,
      planningClient: { columns: { id: true } },
    },
  });
  if (!household) return undefined;

  const planningAccounts = household.planningClient
    ? await loadPlanningAccountsForClient(household.planningClient.id)
    : [];

  return { ...household, planningAccounts };
}

async function loadPlanningAccountsForClient(clientId: string) {
  const [baseScenario] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
    .limit(1);
  if (!baseScenario) return [];

  const rows = await db.query.accounts.findMany({
    where: and(
      eq(accounts.clientId, clientId),
      eq(accounts.scenarioId, baseScenario.id),
    ),
    with: {
      owners: {
        with: {
          familyMember: { columns: { firstName: true, lastName: true } },
          entity: { columns: { name: true } },
          externalBeneficiary: { columns: { name: true } },
        },
      },
    },
    orderBy: (a, { desc }) => [desc(a.value)],
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    subType: row.subType,
    custodian: row.custodian,
    accountNumberLast4: row.accountNumberLast4,
    value: row.value,
    basis: row.basis,
    owners: row.owners.map((o) => ({
      percent: o.percent,
      name: ownerDisplayName(o),
    })),
  }));
}

function ownerDisplayName(o: {
  familyMember: { firstName: string; lastName: string | null } | null;
  entity: { name: string } | null;
  externalBeneficiary: { name: string } | null;
}): string {
  if (o.familyMember) {
    return `${o.familyMember.firstName} ${o.familyMember.lastName ?? ""}`.trim();
  }
  if (o.entity) return o.entity.name;
  if (o.externalBeneficiary) return o.externalBeneficiary.name;
  return "—";
}

export async function createCrmHousehold(input: CreateCrmHouseholdInput) {
  const firmId = await requireOrgId();

  // Insert the household and any inline contacts atomically, so a failed
  // contact insert never leaves an orphan household behind.
  const { household, contacts } = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(crmHouseholds)
      .values({
        firmId,
        advisorId: input.advisorId,
        name: input.name,
        status: input.status ?? "prospect",
        notes: input.notes,
      })
      .returning();

    const insertedContacts: (typeof crmHouseholdContacts.$inferSelect)[] = [];
    for (const c of input.contacts ?? []) {
      const [contact] = await tx
        .insert(crmHouseholdContacts)
        .values({
          householdId: created.id,
          role: c.role,
          firstName: c.firstName,
          lastName: c.lastName,
          dateOfBirth: c.dateOfBirth,
        })
        .returning();
      insertedContacts.push(contact);
    }

    return { household: created, contacts: insertedContacts };
  });

  // Audit + activity are side records written with the global `db` after the
  // transaction commits (recordAudit/recordActivity don't accept a tx handle).
  await recordAudit({
    action: "crm.household.create",
    resourceType: "crm_household",
    resourceId: household.id,
    firmId,
  });
  await recordActivity({
    householdId: household.id,
    kind: "note",
    title: "Household created",
    occurredAt: new Date(),
  });
  for (const contact of contacts) {
    await recordAudit({
      action: "crm.contact.create",
      resourceType: "crm_contact",
      resourceId: contact.id,
      firmId,
    });
    await recordActivity({
      householdId: household.id,
      kind: "contact_change",
      title: `Added ${contact.role}: ${contact.firstName} ${contact.lastName}`,
      metadata: { contactId: contact.id, role: contact.role },
      occurredAt: new Date(),
    });
  }

  return household;
}

export async function updateCrmHousehold(
  id: string,
  patch: Partial<CreateCrmHouseholdInput>,
) {
  const firmId = await requireOrgId();
  const existing = await db.query.crmHouseholds.findFirst({
    where: and(eq(crmHouseholds.id, id), eq(crmHouseholds.firmId, firmId)),
  });
  if (!existing) throw new Error("Household not found");

  const [updated] = await db
    .update(crmHouseholds)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(crmHouseholds.id, id))
    .returning();

  await recordAudit({
    action: "crm.household.update",
    resourceType: "crm_household",
    resourceId: id,
    firmId,
  });

  if (patch.status && patch.status !== existing.status) {
    await recordActivity({
      householdId: id,
      kind: "status_change",
      title: `Status: ${existing.status} → ${patch.status}`,
      metadata: { from: existing.status, to: patch.status },
      occurredAt: new Date(),
    });
  }
  return updated;
}

export async function deleteCrmHousehold(id: string) {
  const firmId = await requireOrgId();
  await db
    .delete(crmHouseholds)
    .where(and(eq(crmHouseholds.id, id), eq(crmHouseholds.firmId, firmId)));
  await recordAudit({
    action: "crm.household.delete",
    resourceType: "crm_household",
    resourceId: id,
    firmId,
  });
}

export async function countCrmHouseholdsForFirm(firmId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(crmHouseholds)
    .where(eq(crmHouseholds.firmId, firmId));
  return row?.count ?? 0;
}
