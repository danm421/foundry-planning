import { db } from "@/db";
import { crmHouseholdAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { requireCrmHouseholdAccess } from "./authz";
import { recordAudit } from "@/lib/audit";
import { recordActivity } from "./activity";
import { buildFieldChanges } from "@/lib/audit/build-changes";
import { CRM_ACCOUNT_FIELD_LABELS } from "@/lib/audit/field-labels";
import { toCrmAccountSnapshot } from "./activity-snapshots";
import type { CreateCrmAccountInput } from "./schemas";

/**
 * Renders an account's last-4 for an activity-feed *title* string. Titles are
 * plain text (unlike `crm_activity.metadata`, which redacts sensitive fields
 * entirely) so we mask the digits with a `••` prefix rather than showing them
 * bare. Preserves the existing "—" fallback for a missing account number.
 */
function maskAccountNumberLast4(last4: string | null | undefined): string {
  return last4 ? `••${last4}` : "—";
}

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
      title: `Added account: ${input.custodian ?? "Custodian"} ${input.accountType ?? ""} (${maskAccountNumberLast4(input.accountNumberLast4)})`,
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
  const changes = buildFieldChanges(
    toCrmAccountSnapshot(existing),
    toCrmAccountSnapshot(updated),
    CRM_ACCOUNT_FIELD_LABELS,
  );
  if (changes.length > 0) {
    await recordActivity(
      {
        householdId: existing.householdId,
        kind: "account_change",
        title: `Updated account ${existing.custodian ?? "—"} ${maskAccountNumberLast4(existing.accountNumberLast4)}`,
        metadata: { accountId, changes },
        occurredAt: new Date(),
      },
      { actorUserId: userId ?? "" },
    );
  }
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
      title: `Removed account ${existing.custodian ?? "—"} ${maskAccountNumberLast4(existing.accountNumberLast4)}`,
      occurredAt: new Date(),
    },
    { actorUserId: userId ?? "" },
  );
}
