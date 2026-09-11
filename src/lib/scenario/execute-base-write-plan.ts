// src/lib/scenario/execute-base-write-plan.ts
//
// IO. Applies a BaseWritePlan to the base-case rows inside an open transaction.
// FK-safe order: inserts ranked by the FK graph (see INSERT_RANK) → updates →
// singleton updates → removes (children/cascades cleared by DB ON DELETE
// CASCADE). Synthetic add ids are remapped to DB-generated uuids so dependent
// references resolve. Scope columns (clientId, scenarioId) are injected and
// matched ONLY when the target table actually has them — most base tables are
// scenario-scoped, but a few (e.g. the client-scoped `gifts` table) are not.
// Mirrors save-to-base's security posture: every statement is scoped to the
// base scenario / client it owns.
import { and, eq, getTableColumns } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { clients, planSettings } from "@/db/schema";
import type { BaseWritePlan } from "./promote-to-base-types";
import { PROMOTE_TABLE_REGISTRY, type PromoteTx } from "./promote-table-registry";
import { coerceForTable } from "./promote-coerce";

interface ExecCtx {
  clientId: string;
  baseScenarioId: string;
}

/**
 * Columns on dependent rows that reference a parent row and must be remapped
 * when that parent was inserted in this batch under a synthetic id.
 *
 * DERIVATION RULE — re-derive from `src/db/schema.ts` when a column is added:
 * every `.references()` column that (1) lives on a table in
 * `PROMOTE_TABLE_REGISTRY`, (2) points at a DIFFERENT promotable kind's table,
 * and (3) can actually appear in that kind's add payload. Columns pointing at
 * non-promotable tables (`clients`, `scenarios`, `model_portfolios`,
 * `plaid_items`, …) are excluded — those ids are never minted by a promote.
 *
 * SELF-references are excluded too (`accounts.roth_rollover_account_id`,
 * `asset_transactions.purchase_transaction_id`, `gifts.parent_gift_id`): the
 * rank table below orders kinds against each other, not rows within one kind,
 * so a same-kind parent is only remapped by luck of plan order. `parentAccountId`
 * is listed because `liabilities.parent_account_id` is a genuine cross-kind FK.
 *
 * Each entry is INERT unless the value it finds is a synthetic targetId inserted
 * in this same batch — a base-plan id passes through untouched.
 *
 * Deliberately NOT listed: `gifts.liability_id`. The gift translator omits it
 * (`promote-gift-translate.ts`), so no draft payload carries it.
 * `surplusSaveAccountId` is pre-existing and lives on `plan_settings`, which is
 * a singleton the executor updates without remapping — left alone rather than
 * removed, since nothing here made it dead.
 */
const REF_COLUMNS = [
  // → accounts
  "accountId",
  "sourceAccountId",
  "targetAccountId",
  "destinationAccountId",
  "proceedsAccountId",
  "parentAccountId",
  "surplusSaveAccountId",
  "cashAccountId",
  "ownerAccountId",
  "linkedPropertyId",
  "sourcePolicyAccountId",
  "businessAccountId",
  "fundingAccountId",
  // → entities
  "ownerEntityId",
  "recipientEntityId",
  "businessEntityId",
  // → family_members
  "grantorFamilyMemberId",
  "beneficiaryFamilyMemberId",
  "forFamilyMemberId",
  "recipientFamilyMemberId",
  // → external_beneficiaries
  "recipientExternalBeneficiaryId",
];

/**
 * FK-safe insert order, derived from the same FK graph as `REF_COLUMNS`: a kind
 * must be inserted before any kind whose columns reference it, because a
 * dependent row's synthetic reference is only resolvable once `idRemap` holds
 * the parent's generated id.
 *
 *   0 — entity, family_member, external_beneficiary: no outgoing FK to any
 *       other promotable kind, and gifts/accounts/incomes/expenses all FK to them.
 *   1 — account: FKs only to family_members (grantor/beneficiary), and most
 *       other kinds FK to accounts.
 *   2 — income (→ entities, accounts) and liability (→ accounts). Incomes stay
 *       ahead of savings rules, whose salary-basis join rows FK to incomes.id
 *       and resolve through idRemap; liabilities stay ahead of gifts, whose
 *       bundled child carries a liability id.
 *   3 — everything else. Kinds with no outgoing promotable FK at all (will,
 *       client_deduction, client_tax_adjustment, relocation, reinvestment) sit
 *       here harmlessly: nothing references them.
 *
 * Array#sort is stable, so ties keep the plan's own order. That is what makes
 * `loadScenarioChanges`'s missing ORDER BY stop mattering for cross-kind FKs —
 * ranking by kind is the contract, not row order.
 */
const INSERT_RANK: Record<string, number> = {
  entity: 0,
  family_member: 0,
  external_beneficiary: 0,
  account: 1,
  income: 2,
  liability: 2,
};

const insertRank = (kind: string) => INSERT_RANK[kind] ?? 3;

type Cols = Record<string, PgColumn>;

/** Scope-column values to inject on insert — only those the table actually has. */
function scopeValues(cols: Cols, ctx: ExecCtx): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ("clientId" in cols) out.clientId = ctx.clientId;
  if ("scenarioId" in cols) out.scenarioId = ctx.baseScenarioId;
  return out;
}

/** id + scope where-clause for update/delete — scoped by whatever the table has. */
function scopeWhere(cols: Cols, id: string, ctx: ExecCtx) {
  const conds = [eq(cols.id, id)];
  if ("clientId" in cols) conds.push(eq(cols.clientId, ctx.clientId));
  if ("scenarioId" in cols) conds.push(eq(cols.scenarioId, ctx.baseScenarioId));
  return and(...conds);
}

export async function executeBaseWritePlan(
  tx: PromoteTx,
  plan: BaseWritePlan,
  ctx: ExecCtx,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const bump = (k: string) => {
    counts[k] = (counts[k] ?? 0) + 1;
  };
  const idRemap = new Map<string, string>();
  // Child writers/updaters remap same-batch synthetic references (e.g. an
  // expense's dedicatedAccountIds pointing at an account added in this plan,
  // or a savings rule's salaryIncomeIds pointing at a new salary) through the
  // shared idRemap — populated parents-first by the sort below.
  const childCtx = { clientId: ctx.clientId, baseScenarioId: ctx.baseScenarioId, idRemap };

  const inserts = [...plan.inserts].sort((a, b) => insertRank(a.kind) - insertRank(b.kind));
  for (const ins of inserts) {
    const entry = PROMOTE_TABLE_REGISTRY[ins.kind];
    if (!entry) throw new Error(`promote: no table for kind ${ins.kind}`);
    const cols = getTableColumns(entry.table) as Cols;
    // A kind whose change payload is an editor DRAFT rather than a row must be
    // reshaped first — `coerceForTable` keeps only exact column-name matches,
    // so an untranslated draft loses every field the row names differently,
    // silently. `translate` is absent on every kind but `gift`.
    const translated = entry.translate ? entry.translate(ins.raw) : ins.raw;
    // Remap AFTER translate, not before. A gift draft names its recipient
    // NESTED (`recipient: {kind, id}`) and it only becomes a `recipientEntityId`
    // column once the translator has run, so a remap that fired first could
    // never see it and carried a scenario-only entity id straight into the FK.
    // Byte-identical for every other kind (no `translate`, so this is `ins.raw`
    // either way) and for the gift's own `accountId`, which `giftDraftToRow`
    // copies through untouched.
    const payload = remapRefs(translated, idRemap);
    const values: Record<string, unknown> = {
      ...coerceForTable(entry.table, payload),
      ...scopeValues(cols, ctx),
    };
    const newId = entry.preserveId
      ? await upsertPreservingId(tx, entry.table, cols, ins.targetId, values, ctx)
      : await insertWithGeneratedId(tx, entry.table, cols, values);
    idRemap.set(ins.targetId, newId);
    if (entry.childWriter) await entry.childWriter(tx, newId, ins.raw, childCtx);
    bump(ins.kind);
  }

  for (const u of plan.updates) {
    const entry = PROMOTE_TABLE_REGISTRY[u.kind];
    if (!entry) throw new Error(`promote: no table for kind ${u.kind}`);
    const cols = getTableColumns(entry.table) as Cols;
    const set: Record<string, unknown> = coerceForTable(
      entry.table,
      remapRefs(u.set, idRemap),
    );
    if ("updatedAt" in cols) set.updatedAt = new Date();
    const matched = await tx
      .update(entry.table)
      .set(set as never)
      .where(scopeWhere(cols, u.id, ctx))
      .returning({ id: cols.id });
    // Only rewrite child rows for an update that hit a base row — reinserting
    // children for a miss would FK-crash where the update itself was a no-op.
    if (matched.length > 0 && entry.childUpdater) {
      await entry.childUpdater(tx, u.id, u.set, childCtx);
    }
    bump(u.kind);
  }

  for (const s of plan.singletonUpdates) {
    if (s.kind === "client") {
      await tx
        .update(clients)
        .set({ ...coerceForTable(clients, s.set), updatedAt: new Date() } as never)
        .where(eq(clients.id, ctx.clientId));
    } else {
      await tx
        .update(planSettings)
        .set({ ...coerceForTable(planSettings, s.set), updatedAt: new Date() } as never)
        .where(
          and(
            eq(planSettings.clientId, ctx.clientId),
            eq(planSettings.scenarioId, ctx.baseScenarioId),
          ),
        );
    }
    bump(s.kind);
  }

  for (const r of plan.removes) {
    const entry = PROMOTE_TABLE_REGISTRY[r.kind];
    if (!entry) continue; // nested / non-row cascades have no base table
    const cols = getTableColumns(entry.table) as Cols;
    await tx.delete(entry.table).where(scopeWhere(cols, r.id, ctx));
    bump(`${r.kind}.remove`);
  }

  return counts;
}

/** Insert an add row and let the DB mint the id. The default: a change's
 *  targetId is a synthetic uuid the scenario invented, and dependent rows reach
 *  the generated id through `idRemap`. */
async function insertWithGeneratedId(
  tx: PromoteTx,
  table: PgTable,
  cols: Cols,
  values: Record<string, unknown>,
): Promise<string> {
  const insertValues = { ...values };
  delete insertValues.id; // let the DB generate a fresh uuid
  const [row] = await tx
    .insert(table)
    .values(insertValues as never)
    .returning({ id: cols.id });
  return (row as { id: string }).id;
}

/**
 * Write an add row under the id the change itself names, UPDATING in place when
 * that row already exists. Gifts need this: a gift has no `edit` op, so editing
 * a base-plan gift is written as an `add` on that gift's own id
 * (lib/gifts/gift-write.ts). Minting a fresh uuid there left the original row
 * untouched beside the new one — one promote, two gifts, the stale one
 * resurrected. Updating in place is also why this is not a delete-then-insert:
 * `gifts.parent_gift_id` is a self-FK with ON DELETE CASCADE, so deleting the
 * base row would take its bundled liability-transfer children with it, and the
 * re-materialised draft cannot recreate them.
 *
 * SCOPING: the UPDATE goes through `scopeWhere`, the same guard `plan.updates`
 * uses — it pins clientId (and scenarioId where the table has one), so an id
 * owned by another firm's client can never match and can never be overwritten.
 * A foreign id therefore falls through to the INSERT and fails loudly on the
 * primary key instead of silently rewriting somebody else's row.
 *
 * ROW SELECTOR: always `targetId` — the id the CHANGE targets — never the
 * payload's own `id`. The two can diverge: `desiredFields` is unconstrained
 * (scenario changes route) and is merged straight into the add payload
 * (changes-writer.ts:219-236), so a change targeting gift G whose payload
 * carries `{id: H}` would otherwise rewrite base gift H with G's data and leave
 * G alive — while the overlay stripped G and showed H untouched. `targetId` is
 * what the overlay strips, so `targetId` is what promotion must write.
 */
async function upsertPreservingId(
  tx: PromoteTx,
  table: PgTable,
  cols: Cols,
  targetId: string,
  values: Record<string, unknown>,
  ctx: ExecCtx,
): Promise<string> {
  const set = { ...values };
  delete set.id;
  if ("updatedAt" in cols) set.updatedAt = new Date();
  const [updated] = await tx
    .update(table)
    .set(set as never)
    .where(scopeWhere(cols, targetId, ctx))
    .returning({ id: cols.id });
  if (updated) return (updated as { id: string }).id;

  const [inserted] = await tx
    .insert(table)
    .values({ ...values, id: targetId } as never)
    .returning({ id: cols.id });
  return (inserted as { id: string }).id;
}

function remapRefs(
  raw: Record<string, unknown>,
  idRemap: Map<string, string>,
): Record<string, unknown> {
  const out = { ...raw };
  for (const col of REF_COLUMNS) {
    const v = out[col];
    if (typeof v === "string" && idRemap.has(v)) out[col] = idRemap.get(v);
  }
  return out;
}
