import { db } from "@/db";
import { crmHouseholdAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { requireCrmHouseholdAccess } from "./authz";
import { recordAudit } from "@/lib/audit";
import { recordActivity } from "./activity";
import type { CreateCrmAccountInput } from "./schemas";

export async function createCrmAccount(householdId: string, input: CreateCrmAccountInput) {
  const { orgId } = await requireCrmHouseholdAccess(householdId);
  const { userId } = await auth();
  const [created] = await db
    .insert(crmHouseholdAccounts)
    .values({
      householdId,
      contactId: input.contactId ?? null,
      accountType: input.accountType,
      custodian: input.custodian,
      accountNumberLast4: input.accountNumberLast4,
      balance: input.balance != null ? String(input.balance) : null,
      balanceAsOf: input.balanceAsOf,
      notes: input.notes,
    })
    .returning();
  await recordAudit({
    action: "crm.account.create",
    resourceType: "crm_account",
    resourceId: created.id,
    firmId: orgId,
  });
  await recordActivity(
    {
      householdId,
      kind: "account_change",
      title: `Added account: ${input.custodian ?? "Custodian"} ${input.accountType ?? ""} (${input.accountNumberLast4 ?? "—"})`,
      metadata: { accountId: created.id },
      occurredAt: new Date(),
    },
    { actorUserId: userId ?? "" },
  );
  return created;
}

export async function updateCrmAccount(accountId: string, patch: Partial<CreateCrmAccountInput>) {
  const existing = await db.query.crmHouseholdAccounts.findFirst({
    where: eq(crmHouseholdAccounts.id, accountId),
  });
  if (!existing) throw new Error("Account not found");
  const { orgId } = await requireCrmHouseholdAccess(existing.householdId);
  const { userId } = await auth();
  const [updated] = await db
    .update(crmHouseholdAccounts)
    .set({
      ...patch,
      balance: patch.balance != null ? String(patch.balance) : undefined,
      updatedAt: new Date(),
    })
    .where(eq(crmHouseholdAccounts.id, accountId))
    .returning();
  await recordAudit({
    action: "crm.account.update",
    resourceType: "crm_account",
    resourceId: accountId,
    firmId: orgId,
  });
  await recordActivity(
    {
      householdId: existing.householdId,
      kind: "account_change",
      title: `Updated account ${existing.custodian ?? "—"} ${existing.accountNumberLast4 ?? "—"}`,
      metadata: { accountId, fields: Object.keys(patch) },
      occurredAt: new Date(),
    },
    { actorUserId: userId ?? "" },
  );
  return updated;
}

export async function deleteCrmAccount(accountId: string) {
  const existing = await db.query.crmHouseholdAccounts.findFirst({
    where: eq(crmHouseholdAccounts.id, accountId),
  });
  if (!existing) return;
  const { orgId } = await requireCrmHouseholdAccess(existing.householdId);
  const { userId } = await auth();
  await db.delete(crmHouseholdAccounts).where(eq(crmHouseholdAccounts.id, accountId));
  await recordAudit({
    action: "crm.account.delete",
    resourceType: "crm_account",
    resourceId: accountId,
    firmId: orgId,
  });
  await recordActivity(
    {
      householdId: existing.householdId,
      kind: "account_change",
      title: `Removed account ${existing.custodian ?? "—"} ${existing.accountNumberLast4 ?? "—"}`,
      occurredAt: new Date(),
    },
    { actorUserId: userId ?? "" },
  );
}
