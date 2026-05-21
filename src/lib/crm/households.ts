import { db } from "@/db";
import { crmHouseholds } from "@/db/schema";
import { and, eq, ilike, sql } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
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
    with: { contacts: true },
    limit,
    offset,
    orderBy: (t, { desc }) => [desc(t.updatedAt)],
  });
}

export async function getCrmHousehold(id: string) {
  const firmId = await requireOrgId();
  return db.query.crmHouseholds.findFirst({
    where: and(eq(crmHouseholds.id, id), eq(crmHouseholds.firmId, firmId)),
    with: {
      contacts: true,
      accounts: { with: { contact: true } },
      documents: true,
    },
  });
}

export async function createCrmHousehold(input: CreateCrmHouseholdInput) {
  const firmId = await requireOrgId();
  const [created] = await db
    .insert(crmHouseholds)
    .values({
      firmId,
      advisorId: input.advisorId,
      name: input.name,
      status: input.status ?? "prospect",
      notes: input.notes,
    })
    .returning();

  await recordAudit({
    action: "crm.household.create",
    resourceType: "crm_household",
    resourceId: created.id,
    firmId,
  });
  await recordActivity({
    householdId: created.id,
    kind: "note",
    title: "Household created",
    occurredAt: new Date(),
  });
  return created;
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
