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
import { and, eq } from "drizzle-orm";
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
  gifts,
  liabilities,
} from "@/db/schema";
import { replaceSalaryIncomes } from "@/lib/clients/salary-basis-incomes";
import { coerceForTable } from "./promote-coerce";
import type { PromoteTx, ChildWriterCtx } from "./promote-table-registry";
import { isEstateFlowGiftDraft } from "./apply-gift-overlays";

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
  await insertLiabilityOwnerRows(tx, parentId, raw.owners);
  await insertExtraPaymentRows(tx, parentId, raw.extraPayments);
}

/**
 * Rewrites liability owners and extra payments after a liability EDIT.
 *
 * `coerceForTable` filters the edit's `set` down to real table columns, so
 * without this an edited `owners` array simply vanishes and the UPDATE degrades
 * to a silent `updatedAt` no-op — a liability retitled into or out of a trust
 * would promote with its OLD `liability_owners` rows intact. `liability-upsert`
 * is a new solver writer, and the dissolve lever uses it.
 *
 * Each array is independent: absence means "leave the base rows alone", present
 * means delete-then-reinsert, exactly as `updateExpenseChildren` does.
 */
export async function updateLiabilityChildren(
  tx: PromoteTx,
  parentId: string,
  set: Record<string, unknown>,
): Promise<void> {
  if ("owners" in set) {
    await tx.delete(liabilityOwners).where(eq(liabilityOwners.liabilityId, parentId));
    await insertLiabilityOwnerRows(tx, parentId, set.owners);
  }
  if ("extraPayments" in set) {
    await tx.delete(extraPayments).where(eq(extraPayments.liabilityId, parentId));
    await insertExtraPaymentRows(tx, parentId, set.extraPayments);
  }
}

/** liabilityOwners has no externalBeneficiaryId column (only family_member /
 *  entity), unlike accountOwners. */
async function insertLiabilityOwnerRows(
  tx: PromoteTx,
  liabilityId: string,
  raw: unknown,
): Promise<void> {
  for (const o of (raw as Array<Record<string, unknown>> | undefined) ?? []) {
    const values = coerceForTable(liabilityOwners, {
      liabilityId,
      familyMemberId: o.kind === "family_member" ? (o.familyMemberId ?? null) : null,
      entityId: o.kind === "entity" ? (o.entityId ?? null) : null,
      percent: o.percent,
    });
    await tx.insert(liabilityOwners).values(values as never);
  }
}

async function insertExtraPaymentRows(
  tx: PromoteTx,
  liabilityId: string,
  raw: unknown,
): Promise<void> {
  for (const p of (raw as Array<Record<string, unknown>> | undefined) ?? []) {
    const values = coerceForTable(extraPayments, {
      liabilityId,
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

/** The salary ids a rule's percent resolves against, with same-batch synthetic
 *  income ids resolved to their DB uuids. The tenant guard for these runs
 *  BEFORE the promote transaction (promote-to-base.ts) on exactly the ids that
 *  are NOT satisfied by an in-batch income insert — a `db`-scoped read cannot
 *  see this transaction's uncommitted rows, so checking them here would reject
 *  a legal promotion. Mirrors the dedicated-account guard. */
function salaryIncomeIdsFrom(ids: unknown, idRemap: Map<string, string>): string[] {
  if (!Array.isArray(ids)) return [];
  return ids
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .map((id) => idRemap.get(id) ?? id);
}

/** Inserts savingsScheduleOverrides rows from raw.scheduleOverrides, and
 *  savingsRuleSalaryIncomes rows from raw.salaryIncomeIds (which salaries a
 *  percent-of-salary contribution resolves against). */
export async function writeSavingsRuleChildren(
  tx: PromoteTx,
  parentId: string,
  raw: Record<string, unknown>,
  ctx: ChildWriterCtx,
): Promise<void> {
  const overrides = raw.scheduleOverrides as Record<number, number> | undefined;
  for (const [year, amount] of Object.entries(overrides ?? {})) {
    const values = coerceForTable(savingsScheduleOverrides, {
      savingsRuleId: parentId,
      year: Number(year),
      amount,
    });
    await tx.insert(savingsScheduleOverrides).values(values as never);
  }

  const salaryIds = salaryIncomeIdsFrom(raw.salaryIncomeIds, ctx.idRemap);
  // Nothing to replace on a row that was just inserted, so skip the write
  // entirely rather than issuing a delete that can never match.
  if (salaryIds.length > 0) await replaceSalaryIncomes(tx, parentId, salaryIds);
}

/** Rewrites savingsRuleSalaryIncomes after a savings-rule EDIT. The edit set
 *  only carries `salaryIncomeIds` when the scenario changed it (field diff), so
 *  absence means "leave the base rows alone"; a present-but-empty/undefined
 *  value means the basis moved off "selected" and the rows are cleared.
 *  Delete-then-reinsert via the shared replaceSalaryIncomes, exactly as
 *  updateExpenseChildren does for dedicated accounts. */
export async function updateSavingsRuleChildren(
  tx: PromoteTx,
  parentId: string,
  set: Record<string, unknown>,
  ctx: ChildWriterCtx,
): Promise<void> {
  if (!("salaryIncomeIds" in set)) return;
  await replaceSalaryIncomes(
    tx,
    parentId,
    salaryIncomeIdsFrom(set.salaryIncomeIds, ctx.idRemap),
  );
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
  await insertWillBequestRows(tx, parentId, raw.bequests);
  await insertWillResiduaryRows(tx, parentId, raw.residuaryRecipients);
}

/**
 * Rewrites will bequests and residuary recipients after a will EDIT.
 *
 * `coerceForTable` filters the edit's `set` down to real table columns, so
 * without this `bequests` / `residuaryRecipients` vanish and the UPDATE degrades
 * to a silent `updatedAt` no-op. Promoting a trust dissolve then leaves the base
 * will still paying to the trust the same promote just deleted — and
 * `will_bequest_recipients.recipientId` carries NO foreign key, so nothing
 * cleans the orphan up.
 *
 * Each array is independent: absence means "leave the base rows alone", present
 * means delete-then-reinsert. `will_bequest_recipients` cascades from
 * `will_bequests`, so deleting the bequests takes their recipients with them.
 */
export async function updateWillChildren(
  tx: PromoteTx,
  parentId: string,
  set: Record<string, unknown>,
): Promise<void> {
  if ("bequests" in set) {
    await tx.delete(willBequests).where(eq(willBequests.willId, parentId));
    await insertWillBequestRows(tx, parentId, set.bequests);
  }
  if ("residuaryRecipients" in set) {
    await tx
      .delete(willResiduaryRecipients)
      .where(eq(willResiduaryRecipients.willId, parentId));
    await insertWillResiduaryRows(tx, parentId, set.residuaryRecipients);
  }
}

async function insertWillBequestRows(
  tx: PromoteTx,
  willId: string,
  raw: unknown,
): Promise<void> {
  for (const b of (raw as Array<Record<string, unknown>> | undefined) ?? []) {
    const bequestValues = coerceForTable(willBequests, {
      willId,
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

    for (const r of (b.recipients as Array<Record<string, unknown>> | undefined) ?? []) {
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
}

async function insertWillResiduaryRows(
  tx: PromoteTx,
  willId: string,
  raw: unknown,
): Promise<void> {
  for (const r of (raw as Array<Record<string, unknown>> | undefined) ?? []) {
    const values = coerceForTable(willResiduaryRecipients, {
      willId,
      recipientKind: r.recipientKind,
      recipientId: r.recipientId ?? null,
      tier: r.tier ?? "primary",
      percentage: r.percentage,
      sortOrder: r.sortOrder,
    });
    await tx.insert(willResiduaryRecipients).values(values as never);
  }
}

// ── Gift children ──────────────────────────────────────────────────────────

/**
 * Re-creates the bundled liability transfer that rides along with an asset gift.
 *
 * `POST /api/clients/[id]/gifts` does two things for an asset transfer: it
 * inserts the gift row AND, when the gifted account has a linked liability,
 * a SECOND `gifts` row carrying `liabilityId` and `parentGiftId` — so the
 * mortgage leaves the estate with the property. A scenario bypasses that route.
 * While the scenario is live the numbers are still right, because the overlay
 * synthesises the matching liability event from `linkedPropertyId`
 * (`estate-flow-gifts.ts`). Promotion had no equivalent step: it emitted one
 * row, and the projection loader builds liability gift events from STORED rows
 * with `liabilityId != null`. So at the moment of promote the debt silently
 * stopped following the property — 30% of a property moved out of the estate
 * while 30% of its mortgage stayed with the household, with no error.
 *
 * Rewrite, not append: a promoted EDIT of a base asset gift reaches this
 * function too (the id-preserving upsert UPDATEs the parent, then this runs),
 * so the parent's children are cleared and rebuilt from the promoted payload.
 * That keeps a re-promoted gift from growing a second mortgage row, keeps the
 * child's year/percent in step with the parent, and drops the child entirely
 * when the gift stops being an asset transfer.
 *
 * SCOPING: `clientId` comes from `ctx`, never from the payload, and the
 * liability lookup is pinned to that client AND the base scenario — the same
 * posture as `scopeValues`/`scopeWhere` in the executor.
 *
 * ONE deliberate difference from the route: the recipient is carried across in
 * full (whichever of the three columns the draft names), where the route copies
 * only `recipientEntityId`. The route's version cannot satisfy
 * `gifts_recipient_exactly_one` for a non-entity recipient, and the overlay this
 * mirrors carries the whole recipient — so copying the route literally would
 * promote a row the scenario never showed, or fail the whole promote. Every
 * OTHER column matches the route, `event_kind` and `valuation_discount`
 * included; see the notes at the insert.
 */
export async function writeGiftChildren(
  tx: PromoteTx,
  parentId: string,
  raw: Record<string, unknown>,
  ctx: ChildWriterCtx,
): Promise<void> {
  // A payload that is not a DRAFT at all is a legacy row-shaped change, written
  // before the draft convention. It says nothing about the gift's children, so
  // it must not clear them: doing that destroys the base gift's bundled
  // liability row and never rebuilds it — F5's own defect, inverted. Checked
  // BEFORE the delete; `kind !== "asset-once"` below is checked after, because
  // a draft that stopped being an asset transfer really does drop its child.
  if (!isEstateFlowGiftDraft(raw)) return;

  // Clear first — see the rewrite note above. Scoped to this client so the
  // delete can never reach another tenant's rows.
  await tx
    .delete(gifts)
    .where(and(eq(gifts.parentGiftId, parentId), eq(gifts.clientId, ctx.clientId)));

  if (raw.kind !== "asset-once") return;
  const draftAccountId = typeof raw.accountId === "string" ? raw.accountId : null;
  const percent = typeof raw.percent === "number" ? raw.percent : null;
  const year = typeof raw.year === "number" ? raw.year : null;
  if (draftAccountId == null || percent == null || year == null) return;

  // The same remap the parent payload got: an account added in this very batch
  // lives in the DB under a generated uuid, not the synthetic id the draft names.
  const accountId = ctx.idRemap.get(draftAccountId) ?? draftAccountId;

  const [linked] = await tx
    .select({ id: liabilities.id })
    .from(liabilities)
    .where(
      and(
        eq(liabilities.linkedPropertyId, accountId),
        eq(liabilities.clientId, ctx.clientId),
        eq(liabilities.scenarioId, ctx.baseScenarioId),
      ),
    );
  if (!linked) return;

  const recipient = raw.recipient as { kind?: string; id?: string } | undefined;
  // The same remap `accountId` got above, for the same reason: a scenario that
  // CREATES the trust and gifts to it names it by a synthetic id, and the real
  // entities row only exists under a generated uuid. Without this the child
  // re-opens the FK violation the parent insert just stopped hitting — and the
  // whole promote transaction rolls back.
  const recipientId =
    recipient?.id == null ? null : ctx.idRemap.get(recipient.id) ?? recipient.id;
  await tx.insert(gifts).values({
    clientId: ctx.clientId,
    year,
    amount: null,
    grantor: raw.grantor as typeof gifts.$inferInsert["grantor"],
    recipientEntityId: recipient?.kind === "entity" ? recipientId : null,
    recipientFamilyMemberId: recipient?.kind === "family_member" ? recipientId : null,
    recipientExternalBeneficiaryId:
      recipient?.kind === "external_beneficiary" ? recipientId : null,
    accountId: null,
    liabilityId: linked.id,
    percent: String(percent),
    // valuationDiscount is deliberately absent, exactly as in the gift route: a
    // liability transfer contributes $0 to the gift ledger and the normalizer
    // skips these rows, so a discount here would be dead data — and a double
    // count against the parent's discount if that ever changed.
    parentGiftId: parentId,
    useCrummeyPowers: false,
    // eventKind is deliberately absent, exactly as in the gift route: the child
    // is a debt transfer, not the parent's transfer-tax event, so copying a
    // `clt_remainder_interest` parent onto it would label the mortgage row with
    // a treatment it never has. The column defaults to `outright`, which is what
    // the route's own child rows carry.
    notes: `Auto-bundled with asset transfer of account ${accountId}`,
  });
}
