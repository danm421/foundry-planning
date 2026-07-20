import { db } from "@/db";
import {
  accounts,
  clients,
  crmHouseholds,
  crmHouseholdContacts,
  crmHouseholdViews,
  plaidItems,
  scenarios,
} from "@/db/schema";
import { and, desc, eq, ilike, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { requireCrmHouseholdAccess } from "./authz";
import { auth } from "@clerk/nextjs/server";
import { resolveVisibleAdvisorIds, advisorScopeCondition } from "@/lib/visibility";
import { recordAudit } from "@/lib/audit";
import { recordDelete } from "@/lib/audit/record-helpers";
import { toHouseholdSnapshot } from "@/lib/audit/snapshots/household";
import { recordActivity } from "./activity";
import { resolveContactDateOfBirth } from "./default-dob";
import { deriveNameForHousehold } from "./sync-household-name";
import { revokePlaidTokens } from "@/lib/plaid/revoke";
import type { CreateCrmHouseholdInput } from "./schemas";

type CrmHouseholdStatus = "prospect" | "active" | "inactive" | "archived";

export async function listCrmHouseholds(opts?: {
  search?: string;
  status?: string;
  deleted?: boolean;
  limit?: number;
  offset?: number;
}) {
  const firmId = await requireOrgId();
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;
  const conditions = [eq(crmHouseholds.firmId, firmId)];
  conditions.push(
    opts?.deleted
      ? isNotNull(crmHouseholds.deletedAt)
      : isNull(crmHouseholds.deletedAt),
  );
  if (opts?.status) {
    conditions.push(eq(crmHouseholds.status, opts.status as CrmHouseholdStatus));
  }
  if (opts?.search) conditions.push(ilike(crmHouseholds.name, `%${opts.search}%`));
  const { userId, orgRole } = await auth();
  const visible = await resolveVisibleAdvisorIds(userId ?? "", orgRole, firmId);
  const scope = advisorScopeCondition(crmHouseholds.advisorId, visible);
  if (scope) conditions.push(scope);

  return db.query.crmHouseholds.findMany({
    where: and(...conditions),
    with: {
      contacts: true,
      planningClient: { columns: { id: true } },
    },
    limit,
    offset,
    orderBy: (t, { desc }) =>
      opts?.deleted ? [desc(t.deletedAt)] : [desc(t.updatedAt)],
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
    isNull(crmHouseholds.deletedAt),
  ];
  if (opts.status) {
    conditions.push(eq(crmHouseholds.status, opts.status as CrmHouseholdStatus));
  }
  if (opts.search) {
    conditions.push(ilike(crmHouseholds.name, `%${opts.search}%`));
  }
  const { userId: callerId, orgRole } = await auth();
  const visible = await resolveVisibleAdvisorIds(callerId ?? "", orgRole, firmId);
  const scope = advisorScopeCondition(crmHouseholds.advisorId, visible);
  if (scope) conditions.push(scope);

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
      planningClient: {
        columns: { id: true },
        with: {
          familyMembers: {
            // family_members also holds the client/spouse self-rows
            // (syncHouseholdFamilyMembers) — the CRM family list excludes them.
            where: (fm, { notInArray }) => notInArray(fm.role, ["client", "spouse"]),
            orderBy: (fm, { asc }) => [asc(fm.relationship), asc(fm.firstName)],
          },
        },
      },
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
        nameIsCustom: input.nameIsCustom ?? false,
        status: input.status ?? "prospect",
        state: input.state ?? null,
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
          dateOfBirth: resolveContactDateOfBirth(c.role, c.dateOfBirth),
          // Seed the primary contact's address state from the household
          // residence so the contacts tab renders a state immediately.
          state: c.role === "primary" ? (input.state ?? null) : null,
        })
        .returning();
      insertedContacts.push(contact);
    }

    return { household: created, contacts: insertedContacts };
  });

  // Audit + activity are side records written with the global `db` after the
  // transaction commits (recordAudit/recordActivity don't accept a tx handle).
  const { userId: actorId } = await auth();
  await recordAudit({
    action: "crm.household.create",
    resourceType: "crm_household",
    resourceId: household.id,
    firmId,
  });
  await recordActivity(
    {
      householdId: household.id,
      kind: "note",
      title: "Household created",
      occurredAt: new Date(),
    },
    { actorUserId: actorId ?? "" },
  );
  for (const contact of contacts) {
    await recordAudit({
      action: "crm.contact.create",
      resourceType: "crm_contact",
      resourceId: contact.id,
      firmId,
    });
    await recordActivity(
      {
        householdId: household.id,
        kind: "contact_change",
        title: `Added ${contact.role}: ${contact.firstName} ${contact.lastName}`,
        metadata: { contactId: contact.id, role: contact.role },
        occurredAt: new Date(),
      },
      { actorUserId: actorId ?? "" },
    );
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

  // Resolve the name server-side. The client may send a `name`, but it only
  // counts when the household ends up locked — an unlocked household's name is
  // always whatever its contacts derive to, never a string the client asserts.
  // Only engage when the patch actually touches naming; a status-only patch
  // must not rewrite the name.
  const patchTouchesName =
    patch.name !== undefined || patch.nameIsCustom !== undefined;
  const nextIsCustom = patch.nameIsCustom ?? existing.nameIsCustom;
  const resolved: typeof patch = { ...patch };

  if (patchTouchesName && !nextIsCustom) {
    const derived = await deriveNameForHousehold(db, id);
    // No primary contact means nothing to derive; `name` is NOT NULL, so keep
    // what's there rather than writing a null.
    resolved.name = derived ?? existing.name;
  }

  const [updated] = await db
    .update(crmHouseholds)
    .set({ ...resolved, updatedAt: sql`now()` })
    .where(eq(crmHouseholds.id, id))
    .returning();

  await recordAudit({
    action: "crm.household.update",
    resourceType: "crm_household",
    resourceId: id,
    firmId,
  });

  if (patch.status && patch.status !== existing.status) {
    const { userId } = await auth();
    await recordActivity(
      {
        householdId: id,
        kind: "status_change",
        title: `Status: ${existing.status} → ${patch.status}`,
        metadata: { from: existing.status, to: patch.status },
        occurredAt: new Date(),
      },
      { actorUserId: userId ?? "" },
    );
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

/** Move a household to the Trash. Idempotent — returns early if already there. */
export async function softDeleteCrmHousehold(id: string, deletedBy: string) {
  const firmId = await requireOrgId();
  const existing = await db.query.crmHouseholds.findFirst({
    where: and(eq(crmHouseholds.id, id), eq(crmHouseholds.firmId, firmId)),
  });
  if (!existing) throw new Error("Household not found");
  if (existing.deletedAt) return existing;

  const [updated] = await db
    .update(crmHouseholds)
    .set({ deletedAt: sql`now()`, deletedBy, updatedAt: sql`now()` })
    .where(eq(crmHouseholds.id, id))
    .returning();

  const { userId } = await auth();
  await recordAudit({
    action: "crm.household.soft_delete",
    resourceType: "crm_household",
    resourceId: id,
    firmId,
  });
  await recordActivity(
    {
      householdId: id,
      kind: "status_change",
      title: "Household moved to Trash",
      occurredAt: new Date(),
    },
    { actorUserId: userId ?? "" },
  );
  return updated;
}

/** Restore a household from the Trash. Idempotent for already-live rows. */
export async function restoreCrmHousehold(id: string) {
  const firmId = await requireOrgId();
  const existing = await db.query.crmHouseholds.findFirst({
    where: and(eq(crmHouseholds.id, id), eq(crmHouseholds.firmId, firmId)),
  });
  if (!existing) throw new Error("Household not found");
  if (!existing.deletedAt) return existing;

  const [updated] = await db
    .update(crmHouseholds)
    .set({ deletedAt: null, deletedBy: null, updatedAt: sql`now()` })
    .where(eq(crmHouseholds.id, id))
    .returning();

  const { userId } = await auth();
  await recordAudit({
    action: "crm.household.restore",
    resourceType: "crm_household",
    resourceId: id,
    firmId,
  });
  await recordActivity(
    {
      householdId: id,
      kind: "status_change",
      title: "Household restored from Trash",
      occurredAt: new Date(),
    },
    { actorUserId: userId ?? "" },
  );
  return updated;
}

/**
 * Permanently delete a household and everything under it. RESTRICT-safe: the
 * planning `clients` row (if any) is deleted first — cascading all planning
 * children — before the `crm_households` row, which cascades CRM contacts /
 * views / documents / activity. Firm-agnostic so the purge cron can call it
 * across firms; the manual-delete endpoint supplies the caller's firmId.
 */
export async function purgeCrmHouseholdById(
  id: string,
  firmId: string,
  force = false,
) {
  const household = await db.query.crmHouseholds.findFirst({
    where: and(eq(crmHouseholds.id, id), eq(crmHouseholds.firmId, firmId)),
    with: { planningClient: { columns: { id: true } } },
  });
  if (!household) throw new Error("Household not found");
  if (!force && !household.deletedAt) {
    // Manual UI deletes must trash first; the GDPR retention purge cron passes
    // force=true to erase the live households of an already-archived firm.
    throw new Error("Household must be trashed before it can be purged");
  }

  const snapshot = toHouseholdSnapshot(household);
  const planningClientId = household.planningClient?.id ?? null;

  // Plaid access tokens, collected BEFORE the client cascade drops
  // plaid_items — afterwards the encrypted tokens are gone and the
  // vendor-side connection can never be severed (audit F3). Lives in this
  // primitive so every deletion path (manual permanent-delete, trash-purge
  // cron, firm purge) inherits the revoke.
  const plaidTokenRows = planningClientId
    ? await db
        .select({ accessToken: plaidItems.accessToken })
        .from(plaidItems)
        .where(eq(plaidItems.clientId, planningClientId))
    : [];

  await db.transaction(async (tx) => {
    if (planningClientId) {
      await tx.delete(clients).where(eq(clients.id, planningClientId));
    }
    await tx.delete(crmHouseholds).where(eq(crmHouseholds.id, id));
  });

  await revokePlaidTokens(
    plaidTokenRows.map((r) => r.accessToken),
    `household-purge ${id}`,
  );

  await recordDelete({
    action: "crm.household.delete",
    resourceType: "crm_household",
    resourceId: id,
    clientId: planningClientId,
    firmId,
    snapshot,
  });
}

/** Manual permanent-delete entry point — org-scoped wrapper over purgeCrmHouseholdById. */
export async function purgeCrmHousehold(id: string) {
  const firmId = await requireOrgId();
  await purgeCrmHouseholdById(id, firmId);
}

export async function countCrmHouseholdsForFirm(firmId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(crmHouseholds)
    .where(eq(crmHouseholds.firmId, firmId));
  return row?.count ?? 0;
}
