// src/lib/scenario/promote-child-writers.ts
//
// Child-row writers for the promote-to-base executor. Each writer inserts the
// nested rows of an add payload into their respective child tables after the
// parent row has been created. Called via the `childWriter` field of a registry
// entry (see promote-table-registry.ts).
//
// Field mapping follows the same patterns established in:
//   - save-to-base/route.ts  (account owners)
//   - create-with-clone.ts   (savings/transfer/roth children)
import { eq } from "drizzle-orm";
import {
  accountOwners,
  liabilityOwners,
  extraPayments,
  incomeScheduleOverrides,
  expenseScheduleOverrides,
  expenseDedicatedAccounts,
  savingsScheduleOverrides,
  transferSchedules,
  reinvestmentAccounts,
  reinvestmentGroups,
  rothConversionSources,
  willBequests,
  willBequestRecipients,
  willResiduaryRecipients,
} from "@/db/schema";
import { coerceForTable } from "./promote-coerce";
import type { PromoteTx, ChildWriterCtx } from "./promote-table-registry";

// ── Account children ───────────────────────────────────────────────────────

/** Inserts accountOwners rows from raw.owners. Each owner carries a `kind`
 *  discriminant plus the relevant FK (`familyMemberId` / `entityId` /
 *  `externalBeneficiaryId`). Mirrors the pattern in save-to-base/route.ts. */
export async function writeAccountChildren(
  tx: PromoteTx,
  parentId: string,
  raw: Record<string, unknown>,
): Promise<void> {
  const owners = (raw.owners as Array<Record<string, unknown>> | undefined) ?? [];
  for (const o of owners) {
    const values = coerceForTable(accountOwners, {
      accountId: parentId,
      familyMemberId: o.kind === "family_member" ? (o.familyMemberId ?? null) : null,
      entityId: o.kind === "entity" ? (o.entityId ?? null) : null,
      externalBeneficiaryId:
        o.kind === "external_beneficiary" ? (o.externalBeneficiaryId ?? null) : null,
      percent: o.percent,
    });
    await tx.insert(accountOwners).values(values as never);
  }
}

// ── Liability children ─────────────────────────────────────────────────────

/** Inserts liabilityOwners and extraPayments rows.
 *  liabilityOwners has no externalBeneficiaryId column (only family_member /
 *  entity). Mirrors the Liability.owners / Liability.extraPayments shapes. */
export async function writeLiabilityChildren(
  tx: PromoteTx,
  parentId: string,
  raw: Record<string, unknown>,
): Promise<void> {
  const owners = (raw.owners as Array<Record<string, unknown>> | undefined) ?? [];
  for (const o of owners) {
    const values = coerceForTable(liabilityOwners, {
      liabilityId: parentId,
      familyMemberId: o.kind === "family_member" ? (o.familyMemberId ?? null) : null,
      entityId: o.kind === "entity" ? (o.entityId ?? null) : null,
      percent: o.percent,
    });
    await tx.insert(liabilityOwners).values(values as never);
  }

  const payments = (raw.extraPayments as Array<Record<string, unknown>> | undefined) ?? [];
  for (const p of payments) {
    const values = coerceForTable(extraPayments, {
      liabilityId: parentId,
      year: p.year,
      type: p.type,
      amount: p.amount,
    });
    await tx.insert(extraPayments).values(values as never);
  }
}

// ── Income children ────────────────────────────────────────────────────────

/** Inserts incomeScheduleOverrides rows from raw.scheduleOverrides (a
 *  Record<number, number> keyed by year). */
export async function writeIncomeChildren(
  tx: PromoteTx,
  parentId: string,
  raw: Record<string, unknown>,
): Promise<void> {
  const overrides = raw.scheduleOverrides as Record<number, number> | undefined;
  if (!overrides) return;
  for (const [year, amount] of Object.entries(overrides)) {
    const values = coerceForTable(incomeScheduleOverrides, {
      incomeId: parentId,
      year: Number(year),
      amount,
    });
    await tx.insert(incomeScheduleOverrides).values(values as never);
  }
}

// ── Expense children ───────────────────────────────────────────────────────

/** Inserts expenseDedicatedAccounts rows in draw order (array index =
 *  sortOrder). Dedupes to respect the (expense_id, account_id) unique
 *  constraint and remaps solver/scenario-synthetic account ids via
 *  ctx.idRemap (a dedicated 529 may be inserted in the same promote batch).
 *  Mirrors save-to-base's insertExpenseDedicatedRows. */
async function insertExpenseDedicatedRows(
  tx: PromoteTx,
  expenseId: string,
  accountIds: string[] | undefined,
  idRemap: Map<string, string>,
): Promise<void> {
  const deduped = [...new Set(accountIds ?? [])];
  if (deduped.length === 0) return;
  for (let i = 0; i < deduped.length; i++) {
    await tx.insert(expenseDedicatedAccounts).values({
      expenseId,
      accountId: idRemap.get(deduped[i]) ?? deduped[i],
      sortOrder: i,
    } as never);
  }
}

/** Inserts expenseScheduleOverrides rows from raw.scheduleOverrides and
 *  expenseDedicatedAccounts rows from raw.dedicatedAccountIds (education
 *  goals' dedicated funding sources). */
export async function writeExpenseChildren(
  tx: PromoteTx,
  parentId: string,
  raw: Record<string, unknown>,
  ctx: ChildWriterCtx,
): Promise<void> {
  const overrides = raw.scheduleOverrides as Record<number, number> | undefined;
  for (const [year, amount] of Object.entries(overrides ?? {})) {
    const values = coerceForTable(expenseScheduleOverrides, {
      expenseId: parentId,
      year: Number(year),
      amount,
    });
    await tx.insert(expenseScheduleOverrides).values(values as never);
  }

  await insertExpenseDedicatedRows(
    tx,
    parentId,
    raw.dedicatedAccountIds as string[] | undefined,
    ctx.idRemap,
  );
}

/** Rewrites expenseDedicatedAccounts after an expense EDIT. The edit set only
 *  carries `dedicatedAccountIds` when the scenario changed it (field diff), so
 *  absence means "leave the base rows alone"; a present-but-empty/undefined
 *  value means the funding was cleared. Delete-then-reinsert mirrors
 *  updateExpenseForClient (expenses-writes.ts). */
export async function updateExpenseChildren(
  tx: PromoteTx,
  parentId: string,
  set: Record<string, unknown>,
  ctx: ChildWriterCtx,
): Promise<void> {
  if (!("dedicatedAccountIds" in set)) return;
  await tx
    .delete(expenseDedicatedAccounts)
    .where(eq(expenseDedicatedAccounts.expenseId, parentId));
  await insertExpenseDedicatedRows(
    tx,
    parentId,
    (set.dedicatedAccountIds ?? undefined) as string[] | undefined,
    ctx.idRemap,
  );
}

// ── SavingsRule children ───────────────────────────────────────────────────

/** Inserts savingsScheduleOverrides rows from raw.scheduleOverrides. */
export async function writeSavingsRuleChildren(
  tx: PromoteTx,
  parentId: string,
  raw: Record<string, unknown>,
): Promise<void> {
  const overrides = raw.scheduleOverrides as Record<number, number> | undefined;
  if (!overrides) return;
  for (const [year, amount] of Object.entries(overrides)) {
    const values = coerceForTable(savingsScheduleOverrides, {
      savingsRuleId: parentId,
      year: Number(year),
      amount,
    });
    await tx.insert(savingsScheduleOverrides).values(values as never);
  }
}

// ── Transfer children ──────────────────────────────────────────────────────

/** Inserts transferSchedules rows from raw.schedules (Transfer.schedules). */
export async function writeTransferChildren(
  tx: PromoteTx,
  parentId: string,
  raw: Record<string, unknown>,
): Promise<void> {
  const schedules = (raw.schedules as Array<Record<string, unknown>> | undefined) ?? [];
  for (const s of schedules) {
    const values = coerceForTable(transferSchedules, {
      transferId: parentId,
      year: s.year,
      amount: s.amount,
    });
    await tx.insert(transferSchedules).values(values as never);
  }
}

// ── RothConversion children ────────────────────────────────────────────────

/** Inserts rothConversionSources rows from raw.sourceAccountIds
 *  (RothConversion.sourceAccountIds — an array of account uuid strings). */
export async function writeRothConversionChildren(
  tx: PromoteTx,
  parentId: string,
  raw: Record<string, unknown>,
): Promise<void> {
  const sourceAccountIds = (raw.sourceAccountIds as string[] | undefined) ?? [];
  for (let i = 0; i < sourceAccountIds.length; i++) {
    const values = coerceForTable(rothConversionSources, {
      rothConversionId: parentId,
      accountId: sourceAccountIds[i],
      sortOrder: i,
    });
    await tx.insert(rothConversionSources).values(values as never);
  }
}

// ── Reinvestment children ──────────────────────────────────────────────────

/** Inserts reinvestmentAccounts (from raw.accountIds) and reinvestmentGroups
 *  (from raw.groupKeys — Reinvestment.groupKeys). */
export async function writeReinvestmentChildren(
  tx: PromoteTx,
  parentId: string,
  raw: Record<string, unknown>,
): Promise<void> {
  const accountIds = (raw.accountIds as string[] | undefined) ?? [];
  for (const accountId of accountIds) {
    const values = coerceForTable(reinvestmentAccounts, {
      reinvestmentId: parentId,
      accountId,
    });
    await tx.insert(reinvestmentAccounts).values(values as never);
  }

  const groupKeys = (raw.groupKeys as string[] | undefined) ?? [];
  for (const groupKey of groupKeys) {
    // reinvestmentGroups has a composite PK (reinvestmentId, groupKey); no
    // auto-generated id column — coerceForTable drops non-column keys cleanly.
    await tx.insert(reinvestmentGroups).values({ reinvestmentId: parentId, groupKey } as never);
  }
}

// ── Will children ──────────────────────────────────────────────────────────

/** Inserts willBequests (with their nested willBequestRecipients) and
 *  willResiduaryRecipients from raw.bequests and raw.residuaryRecipients.
 *  Bequest rows need .returning({ id }) so recipients can reference the
 *  DB-generated bequest id. */
export async function writeWillChildren(
  tx: PromoteTx,
  parentId: string,
  raw: Record<string, unknown>,
): Promise<void> {
  const bequests = (raw.bequests as Array<Record<string, unknown>> | undefined) ?? [];
  for (const b of bequests) {
    const bequestValues = coerceForTable(willBequests, {
      willId: parentId,
      name: b.name,
      kind: b.kind,
      assetMode: b.assetMode ?? null,
      accountId: b.accountId ?? null,
      entityId: b.entityId ?? null,
      liabilityId: b.liabilityId ?? null,
      percentage: b.percentage,
      condition: b.condition,
      sortOrder: b.sortOrder,
    });
    const [inserted] = await tx
      .insert(willBequests)
      .values(bequestValues as never)
      .returning();

    const recipients = (b.recipients as Array<Record<string, unknown>> | undefined) ?? [];
    for (const r of recipients) {
      const recipientValues = coerceForTable(willBequestRecipients, {
        bequestId: inserted.id,
        recipientKind: r.recipientKind,
        recipientId: r.recipientId ?? null,
        percentage: r.percentage,
        sortOrder: r.sortOrder,
      });
      await tx.insert(willBequestRecipients).values(recipientValues as never);
    }
  }

  const residuaryRecipients =
    (raw.residuaryRecipients as Array<Record<string, unknown>> | undefined) ?? [];
  for (const r of residuaryRecipients) {
    const values = coerceForTable(willResiduaryRecipients, {
      willId: parentId,
      recipientKind: r.recipientKind,
      recipientId: r.recipientId ?? null,
      tier: r.tier ?? "primary",
      percentage: r.percentage,
      sortOrder: r.sortOrder,
    });
    await tx.insert(willResiduaryRecipients).values(values as never);
  }
}
