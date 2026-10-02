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
//   - accounts/[accountId]/beneficiaries/route.ts  (beneficiary designations)
import { and, eq } from "drizzle-orm";
import {
  accountOwners,
  beneficiaryDesignations,
  lifeInsurancePolicies,
  lifeInsuranceCashValueSchedule,
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

type Row = Record<string, unknown>;

/** A same-batch synthetic id → the uuid the DB minted for it; any other id
 *  (a base-plan row) passes through. */
const remapId = (id: unknown, ctx: ChildWriterCtx) =>
  typeof id === "string" ? (ctx.idRemap.get(id) ?? id) : null;

/** Display-only policy keys. The engine `LifeInsurancePolicy` lacks them, so a
 *  scenario carries them at the top level of the account payload; the base row
 *  stores them on `life_insurance_policies`. Only the keys present are returned,
 *  so an edit that did not change them leaves the stored values alone. */
const POLICY_DISPLAY_KEYS = ["carrier", "policyNumberLast4"] as const;
function policyDisplayColumns(raw: Row): Row {
  const out: Row = {};
  for (const k of POLICY_DISPLAY_KEYS) if (k in raw) out[k] = raw[k];
  return out;
}

/** Writes an account add's children: owners, the life-insurance policy with its
 *  cash-value schedule, and beneficiary designations. Every family-member /
 *  entity / external-beneficiary ref goes through `ctx.idRemap`, because a
 *  scenario can add the trust or relative in the same promote. Those foreign
 *  keys are global, so promote-to-base tenant-checks every ref NOT satisfied in
 *  the batch before the transaction opens (`collectClientRefs`). */
export async function writeAccountChildren(
  tx: PromoteTx,
  parentId: string,
  raw: Row,
  ctx: ChildWriterCtx,
): Promise<void> {
  await insertAccountOwnerRows(tx, parentId, raw.owners, ctx);
  if (raw.lifeInsurance) {
    const li = raw.lifeInsurance as Row;
    const policy = coerceForTable(lifeInsurancePolicies, {
      ...li,
      ...policyDisplayColumns(raw),
      accountId: parentId,
    });
    await tx.insert(lifeInsurancePolicies).values(policy as never);
    await insertCashValueScheduleRows(tx, parentId, li.cashValueSchedule);
  }
  await insertBeneficiaryRows(tx, parentId, raw.beneficiaries, ctx);
}

/**
 * Rewrites an account's children after an account EDIT. Without it
 * `coerceForTable` filters `owners` / `lifeInsurance` / `beneficiaries` out of
 * the edit's `set` and they vanish at promote.
 *
 * Each key is independent: absent means "leave the base rows alone", present
 * means delete-then-reinsert, as `updateLiabilityChildren` does. The policy row
 * itself is UPSERTED rather than replaced, because its display columns are not
 * part of `lifeInsurance` and an edit that did not change them must keep them.
 *
 * SCOPING: the executor runs this only after the scoped account UPDATE matched,
 * so `parentId` is this client's account. Beneficiary designations carry their
 * own `clientId`, and the delete pins it too.
 */
export async function updateAccountChildren(
  tx: PromoteTx,
  parentId: string,
  set: Row,
  ctx: ChildWriterCtx,
): Promise<void> {
  if ("owners" in set) {
    await tx.delete(accountOwners).where(eq(accountOwners.accountId, parentId));
    await insertAccountOwnerRows(tx, parentId, set.owners, ctx);
  }

  const display = policyDisplayColumns(set);
  if ("lifeInsurance" in set) {
    const li = set.lifeInsurance as Row | null;
    if (!li) {
      // Cascades to the cash-value schedule.
      await tx.delete(lifeInsurancePolicies).where(eq(lifeInsurancePolicies.accountId, parentId));
    } else {
      const columns = coerceForTable(lifeInsurancePolicies, { ...li, ...display });
      delete columns.accountId;
      await tx
        .insert(lifeInsurancePolicies)
        .values({ ...columns, accountId: parentId } as never)
        .onConflictDoUpdate({
          target: lifeInsurancePolicies.accountId,
          set: { ...columns, updatedAt: new Date() } as never,
        });
      await tx
        .delete(lifeInsuranceCashValueSchedule)
        .where(eq(lifeInsuranceCashValueSchedule.policyId, parentId));
      await insertCashValueScheduleRows(tx, parentId, li.cashValueSchedule);
    }
  } else if (Object.keys(display).length > 0) {
    await tx
      .update(lifeInsurancePolicies)
      .set({ ...display, updatedAt: new Date() } as never)
      .where(eq(lifeInsurancePolicies.accountId, parentId));
  }

  if ("beneficiaries" in set) {
    await tx
      .delete(beneficiaryDesignations)
      .where(
        and(
          eq(beneficiaryDesignations.clientId, ctx.clientId),
          eq(beneficiaryDesignations.targetKind, "account"),
          eq(beneficiaryDesignations.accountId, parentId),
        ),
      );
    await insertBeneficiaryRows(tx, parentId, set.beneficiaries, ctx);
  }
}

/** Each owner carries a `kind` discriminant plus the relevant FK. Mirrors
 *  save-to-base/route.ts. */
async function insertAccountOwnerRows(
  tx: PromoteTx,
  accountId: string,
  raw: unknown,
  ctx: ChildWriterCtx,
): Promise<void> {
  for (const o of (raw as Row[] | undefined) ?? []) {
    const values = coerceForTable(accountOwners, {
      accountId,
      familyMemberId: o.kind === "family_member" ? remapId(o.familyMemberId, ctx) : null,
      entityId: o.kind === "entity" ? remapId(o.entityId, ctx) : null,
      externalBeneficiaryId:
        o.kind === "external_beneficiary" ? remapId(o.externalBeneficiaryId, ctx) : null,
      percent: o.percent,
    });
    await tx.insert(accountOwners).values(values as never);
  }
}

/** One batched insert: a schedule can run to dozens of years. Engine rows omit
 *  a column the policy does not schedule; it lands NULL. */
async function insertCashValueScheduleRows(
  tx: PromoteTx,
  policyId: string,
  raw: unknown,
): Promise<void> {
  const rows = ((raw as Row[] | undefined) ?? []).map((r) =>
    coerceForTable(lifeInsuranceCashValueSchedule, {
      policyId,
      year: r.year,
      cashValue: r.cashValue,
      premiumAmount: r.premiumAmount,
      income: r.income,
      deathBenefit: r.deathBenefit,
    }),
  );
  if (rows.length > 0) await tx.insert(lifeInsuranceCashValueSchedule).values(rows as never);
}

/** Engine `BeneficiaryRef`s → designation rows, as the account beneficiaries
 *  route writes them. The scenario's designation `id` is not carried — the DB
 *  mints one. */
async function insertBeneficiaryRows(
  tx: PromoteTx,
  accountId: string,
  raw: unknown,
  ctx: ChildWriterCtx,
): Promise<void> {
  const rows = ((raw as Row[] | undefined) ?? []).map((b, idx) =>
    coerceForTable(beneficiaryDesignations, {
      clientId: ctx.clientId,
      targetKind: "account",
      accountId,
      entityId: null,
      tier: b.tier,
      familyMemberId: remapId(b.familyMemberId, ctx),
      externalBeneficiaryId: remapId(b.externalBeneficiaryId, ctx),
      entityIdRef: remapId(b.entityIdRef, ctx),
      householdRole: b.householdRole ?? null,
      percentage: b.percentage,
      sortOrder: b.sortOrder ?? idx,
    }),
  );
  if (rows.length > 0) await tx.insert(beneficiaryDesignations).values(rows as never);
}

// ── Liability children ─────────────────────────────────────────────────────

/** Inserts liabilityOwners and extraPayments rows.
 *  liabilityOwners has no externalBeneficiaryId column (only family_member /
 *  entity). Mirrors the Liability.owners / Liability.extraPayments shapes.
 *  Owner refs go through `ctx.idRemap`, like account owners. */
export async function writeLiabilityChildren(
  tx: PromoteTx,
  parentId: string,
  raw: Record<string, unknown>,
  ctx: ChildWriterCtx,
): Promise<void> {
  await insertLiabilityOwnerRows(tx, parentId, raw.owners, ctx);
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
  ctx: ChildWriterCtx,
): Promise<void> {
  if ("owners" in set) {
    await tx.delete(liabilityOwners).where(eq(liabilityOwners.liabilityId, parentId));
    await insertLiabilityOwnerRows(tx, parentId, set.owners, ctx);
  }
  if ("extraPayments" in set) {
    await tx.delete(extraPayments).where(eq(extraPayments.liabilityId, parentId));
    await insertExtraPaymentRows(tx, parentId, set.extraPayments);
  }
}

/**
 * `liability_owners` has only family_member_id and entity_id — no
 * externalBeneficiaryId column, unlike `account_owners` — and a CHECK requiring
 * exactly one of them to be set.
 *
 * So an `external_beneficiary` or `gifted_away` owner lands BOTH columns NULL
 * and Postgres aborts the whole promote transaction with a constraint name
 * instead of a message. That shape is reachable: the dissolve lever's
 * `returnOwnersToHeir` deliberately preserves non-trust ownership slices,
 * including a `gifted_away` one, and `liability-upsert` is a new solver writer.
 *
 * Throwing names the owner kind the way `noteOwnerColumns` does for the note
 * tables. Representing these owners properly needs a migration; until then a
 * legible failure beats a constraint violation.
 */
function liabilityOwnerColumns(o: Record<string, unknown>, ctx: ChildWriterCtx) {
  switch (o.kind) {
    case "family_member":
      return { familyMemberId: remapId(o.familyMemberId, ctx), entityId: null };
    case "entity":
      return { familyMemberId: null, entityId: remapId(o.entityId, ctx) };
    default:
      throw new Error(
        `liability owner kind "${String(o.kind)}" has no liability_owners column — ` +
          `only family_member and entity can be promoted`,
      );
  }
}

async function insertLiabilityOwnerRows(
  tx: PromoteTx,
  liabilityId: string,
  raw: unknown,
  ctx: ChildWriterCtx,
): Promise<void> {
  for (const o of (raw as Array<Record<string, unknown>> | undefined) ?? []) {
    const values = coerceForTable(liabilityOwners, {
      liabilityId,
      ...liabilityOwnerColumns(o, ctx),
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
 *  (RothConversion.sourceAccountIds — an array of account uuid strings). A
 *  source the same batch added (a scenario IRA converted from) is remapped to
 *  the id the DB minted; `collectClientRefs` skips those ids on that promise. */
export async function writeRothConversionChildren(
  tx: PromoteTx,
  parentId: string,
  raw: Record<string, unknown>,
  ctx: ChildWriterCtx,
): Promise<void> {
  const sourceAccountIds = (raw.sourceAccountIds as string[] | undefined) ?? [];
  for (let i = 0; i < sourceAccountIds.length; i++) {
    const values = coerceForTable(rothConversionSources, {
      rothConversionId: parentId,
      accountId: remapId(sourceAccountIds[i], ctx),
      sortOrder: i,
    });
    await tx.insert(rothConversionSources).values(values as never);
  }
}

// ── Reinvestment children ──────────────────────────────────────────────────

/** Where a reinvestment payload keeps its one-by-one picks: `pickedAccountIds`,
 *  or — on a change written before that key existed — `accountIds`. Never the
 *  union `accountIds` beside a picks key: base stores the picks alone (the
 *  reinvestments route's `accountIds`), and loading re-expands the groups.
 *  Also how the promote tenant guard finds the ids to check (`collectClientRefs`). */
export function reinvestmentPicksKey(raw: Record<string, unknown>): "pickedAccountIds" | "accountIds" | null {
  if ("pickedAccountIds" in raw) return "pickedAccountIds";
  return "accountIds" in raw ? "accountIds" : null;
}

async function insertReinvestmentPicks(
  tx: PromoteTx,
  parentId: string,
  picks: unknown,
  ctx: ChildWriterCtx,
): Promise<void> {
  for (const accountId of (picks as string[] | null | undefined) ?? []) {
    const values = coerceForTable(reinvestmentAccounts, {
      reinvestmentId: parentId,
      accountId: remapId(accountId, ctx),
    });
    await tx.insert(reinvestmentAccounts).values(values as never);
  }
}

async function insertReinvestmentGroups(
  tx: PromoteTx,
  parentId: string,
  groupKeys: unknown,
): Promise<void> {
  for (const groupKey of (groupKeys as string[] | null | undefined) ?? []) {
    // reinvestmentGroups has a composite PK (reinvestmentId, groupKey); no
    // auto-generated id column — coerceForTable drops non-column keys cleanly.
    await tx.insert(reinvestmentGroups).values({ reinvestmentId: parentId, groupKey } as never);
  }
}

/** Inserts reinvestmentAccounts (from the picks — see `reinvestmentPicksKey`)
 *  and reinvestmentGroups (from raw.groupKeys — Reinvestment.groupKeys). */
export async function writeReinvestmentChildren(
  tx: PromoteTx,
  parentId: string,
  raw: Record<string, unknown>,
  ctx: ChildWriterCtx,
): Promise<void> {
  const picksKey = reinvestmentPicksKey(raw);
  await insertReinvestmentPicks(tx, parentId, picksKey && raw[picksKey], ctx);
  await insertReinvestmentGroups(tx, parentId, raw.groupKeys);
}

/** Rewrites a reinvestment's picks and / or groups after an EDIT, each only when
 *  the edit's `set` names it — exactly as the reinvestments route's PUT does. */
export async function updateReinvestmentChildren(
  tx: PromoteTx,
  parentId: string,
  set: Record<string, unknown>,
  ctx: ChildWriterCtx,
): Promise<void> {
  const picksKey = reinvestmentPicksKey(set);
  if (picksKey) {
    await tx.delete(reinvestmentAccounts).where(eq(reinvestmentAccounts.reinvestmentId, parentId));
    await insertReinvestmentPicks(tx, parentId, set[picksKey], ctx);
  }
  if ("groupKeys" in set) {
    await tx.delete(reinvestmentGroups).where(eq(reinvestmentGroups.reinvestmentId, parentId));
    await insertReinvestmentGroups(tx, parentId, set.groupKeys);
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
  ctx: ChildWriterCtx,
): Promise<void> {
  await insertWillBequestRows(tx, parentId, raw.bequests, ctx);
  await insertWillResiduaryRows(tx, parentId, raw.residuaryRecipients, ctx);
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
  ctx: ChildWriterCtx,
): Promise<void> {
  if ("bequests" in set) {
    await tx.delete(willBequests).where(eq(willBequests.willId, parentId));
    await insertWillBequestRows(tx, parentId, set.bequests, ctx);
  }
  if ("residuaryRecipients" in set) {
    await tx
      .delete(willResiduaryRecipients)
      .where(eq(willResiduaryRecipients.willId, parentId));
    await insertWillResiduaryRows(tx, parentId, set.residuaryRecipients, ctx);
  }
}

/** A bequest's `accountId` / `entityId` / `liabilityId` are global foreign keys
 *  that the promote tenant guard (`collectClientRefs`) skips when a same-batch
 *  insert names them, so each is remapped here. A recipient id (no foreign key)
 *  is remapped too, so it never points at a synthetic id. */
async function insertWillBequestRows(
  tx: PromoteTx,
  willId: string,
  raw: unknown,
  ctx: ChildWriterCtx,
): Promise<void> {
  for (const b of (raw as Array<Record<string, unknown>> | undefined) ?? []) {
    const bequestValues = coerceForTable(willBequests, {
      willId,
      name: b.name,
      kind: b.kind,
      assetMode: b.assetMode ?? null,
      accountId: remapId(b.accountId, ctx),
      entityId: remapId(b.entityId, ctx),
      liabilityId: remapId(b.liabilityId, ctx),
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
        recipientId: remapId(r.recipientId, ctx),
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
  ctx: ChildWriterCtx,
): Promise<void> {
  for (const r of (raw as Array<Record<string, unknown>> | undefined) ?? []) {
    const values = coerceForTable(willResiduaryRecipients, {
      willId,
      recipientKind: r.recipientKind,
      recipientId: remapId(r.recipientId, ctx),
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
