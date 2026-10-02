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
import {
  assertAccountsInClient,
  assertEntitiesInClient,
  assertExternalBeneficiariesInClient,
  assertFamilyMembersInClient,
  assertLiabilitiesInClient,
  type FkCheck,
} from "@/lib/db-scoping";
import type { BaseWritePlan } from "./promote-to-base-types";
import { PROMOTE_TABLE_REGISTRY, type PromoteTx } from "./promote-table-registry";
import { reinvestmentPicksKey } from "./promote-child-writers";
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
 * so a same-kind parent is only remapped by luck of plan order. The one
 * exception is `accounts.parent_account_id` — a Solver-added business always
 * brings its own cash child — which `orderInserts` puts parents-first.
 * `parentAccountId` is listed here for both: the account self-ref and
 * `liabilities.parent_account_id`, a genuine cross-kind FK.
 *
 * Each entry is INERT unless the value it finds is a synthetic targetId inserted
 * in this same batch — a base-plan id passes through untouched. That is why the
 * rule above is stated as "can appear in the payload" and not "is emitted by
 * today's writers": on the legacy row-shaped path the gift translator returns
 * the payload untouched, so a pre-convention change row can carry any `gifts`
 * column — `liabilityId` exactly as much as `businessEntityId`.
 *
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
  // → liabilities
  "liabilityId",
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
 * Array#sort is stable, so ties keep the plan's own order. Ranking by kind is
 * the contract for cross-kind FKs, not row order (`loadScenarioChanges` orders
 * by creation, but an autosave can rewrite an older row after its dependents).
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

type PlannedInsert = BaseWritePlan["inserts"][number];

/**
 * Inserts in FK-safe order: by `INSERT_RANK`, then — inside the `account` rank —
 * an account whose `parentAccountId` names another account inserted in this
 * batch goes after that parent, so `remapRefs` finds the parent's generated id.
 * A scenario business and its "<name> — Cash" child are both `account` adds,
 * and nothing else orders them: a later autosave rewrites the business's add
 * row, so the child can come back first. Everything else keeps the plan's order
 * (a parent is only pulled forward to just before its first child).
 */
function orderInserts(inserts: readonly PlannedInsert[]): PlannedInsert[] {
  const ranked = [...inserts].sort((a, b) => insertRank(a.kind) - insertRank(b.kind));
  const accountsById = new Map(
    ranked.filter((i) => i.kind === "account").map((i) => [i.targetId, i]),
  );
  const out: PlannedInsert[] = [];
  const seen = new Set<PlannedInsert>(); // also stops a malformed parent cycle
  const place = (ins: PlannedInsert) => {
    if (seen.has(ins)) return;
    seen.add(ins);
    const parentId = ins.kind === "account" ? ins.raw.parentAccountId : undefined;
    const parent = typeof parentId === "string" ? accountsById.get(parentId) : undefined;
    if (parent) place(parent);
    out.push(ins);
  };
  for (const ins of ranked) place(ins);
  return out;
}

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

/** What the executor did, and the synthetic→generated id map it built doing it.
 *  The map is RETURNED rather than kept private because the promote has a
 *  second half: `copyGiftSeriesToBase` writes `gift_series` rows whose
 *  recipient may be a trust this very batch created, and only this map knows
 *  the uuid the DB minted for it. */
export interface BaseWriteResult {
  counts: Record<string, number>;
  idRemap: ReadonlyMap<string, string>;
}

export async function executeBaseWritePlan(
  tx: PromoteTx,
  plan: BaseWritePlan,
  ctx: ExecCtx,
): Promise<BaseWriteResult> {
  const counts: Record<string, number> = {};
  const bump = (k: string) => {
    counts[k] = (counts[k] ?? 0) + 1;
  };
  const idRemap = new Map<string, string>();
  // Child writers/updaters remap same-batch synthetic references (e.g. an
  // expense's dedicatedAccountIds pointing at an account added in this plan,
  // or a savings rule's salaryIncomeIds pointing at a new salary) through the
  // shared idRemap — populated parents-first by `orderInserts`.
  const childCtx = { clientId: ctx.clientId, baseScenarioId: ctx.baseScenarioId, idRemap };

  for (const ins of orderInserts(plan.inserts)) {
    const entry = PROMOTE_TABLE_REGISTRY[ins.kind];
    if (!entry) throw new Error(`promote: no table for kind ${ins.kind}`);
    const cols = getTableColumns(entry.table) as Cols;
    // A kind whose change payload is an editor DRAFT rather than a row must be
    // reshaped first — `coerceForTable` keeps only exact column-name matches,
    // so an untranslated draft loses every field the row names differently,
    // silently. Only `gift` (a draft) and `disability_policy` (the engine's
    // nested shape) have a `translate`.
    const translated = entry.translate ? entry.translate(ins.raw) : ins.raw;
    // Remap AFTER translate, not before. A gift draft names its recipient
    // NESTED (`recipient: {kind, id}`) and it only becomes a `recipientEntityId`
    // column once the translator has run, so a remap that fired first could
    // never see it and carried a scenario-only entity id straight into the FK.
    // Order is irrelevant for kinds with no `translate` (this is `ins.raw` either
    // way), for `disability_policy` (its translator renames no ref column) and
    // for the gift's own `accountId`, which `giftDraftToRow` copies through
    // untouched.
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
    // Same reshaping the insert path does, on the edit's partial `set`. Before
    // remap and coercion for the same reason: a key only becomes a column here.
    const translated = entry.translateSet ? entry.translateSet(u.set) : u.set;
    const set: Record<string, unknown> = coerceForTable(
      entry.table,
      remapRefs(translated, idRemap),
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

  return { counts, idRemap };
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

/** The family-member / external-beneficiary / entity / account / liability ids
 *  a plan's child rows will reference. */
export interface ClientRefs {
  familyMemberIds: string[];
  externalBeneficiaryIds: string[];
  entityIds: string[];
  accountIds: string[];
  liabilityIds: string[];
}

/**
 * PURE. Every family member, external beneficiary and entity named by an
 * `owners` or `beneficiaries` array in the plan's inserts and updates, every
 * account a reinvestment picks (`reinvestmentPicksKey`: the picks, or a legacy
 * `accountIds`; never the unstored union beside the picks), every source
 * account a Roth conversion names, and every account, entity and liability a
 * will's bequests name. Those land in `account_owners`, `liability_owners`,
 * `beneficiary_designations`, `reinvestment_accounts`, `roth_conversion_sources`
 * and `will_bequests`, whose foreign keys are GLOBAL, and the scenario changes
 * route validates nothing — so without a check a crafted id could attach
 * another firm's person, trust, account or liability to this client's rows.
 *
 * Ids that a same-batch insert of the matching kind satisfies are left out: they
 * are synthetic, only exist once the transaction has inserted them, and a
 * `db`-scoped read outside that transaction could never find them.
 *
 * INVARIANT: every consumer of a skipped id must remap it through `idRemap`
 * (the account, liability, reinvestment, Roth conversion and will child writers
 * do). A consumer that
 * writes the raw id lets a crafted add whose targetId is another firm's real
 * row smuggle that id past this guard.
 */
export function collectClientRefs(plan: BaseWritePlan): ClientRefs {
  const inBatch = (kind: string) =>
    new Set(plan.inserts.filter((i) => i.kind === kind).map((i) => i.targetId));
  const skip = {
    familyMemberIds: inBatch("family_member"),
    externalBeneficiaryIds: inBatch("external_beneficiary"),
    entityIds: inBatch("entity"),
    accountIds: inBatch("account"),
    liabilityIds: inBatch("liability"),
  };
  const found = {
    familyMemberIds: new Set<string>(),
    externalBeneficiaryIds: new Set<string>(),
    entityIds: new Set<string>(),
    accountIds: new Set<string>(),
    liabilityIds: new Set<string>(),
  };
  const add = (bucket: keyof ClientRefs, id: unknown) => {
    if (typeof id === "string" && id.length > 0 && !skip[bucket].has(id)) found[bucket].add(id);
  };
  const walk = (kind: string, payload: Record<string, unknown>) => {
    if (kind === "reinvestment") {
      const picksKey = reinvestmentPicksKey(payload);
      for (const id of (picksKey ? (payload[picksKey] as unknown[] | null) : null) ?? []) {
        add("accountIds", id);
      }
    }
    if (kind === "roth_conversion") {
      for (const id of (payload.sourceAccountIds as unknown[] | undefined) ?? []) {
        add("accountIds", id);
      }
    }
    if (kind === "will") {
      for (const b of (payload.bequests as Record<string, unknown>[] | undefined) ?? []) {
        add("accountIds", b.accountId);
        add("entityIds", b.entityId);
        add("liabilityIds", b.liabilityId);
      }
    }
    for (const o of (payload.owners as Record<string, unknown>[] | undefined) ?? []) {
      add("familyMemberIds", o.familyMemberId);
      add("externalBeneficiaryIds", o.externalBeneficiaryId);
      add("entityIds", o.entityId);
    }
    for (const b of (payload.beneficiaries as Record<string, unknown>[] | undefined) ?? []) {
      add("familyMemberIds", b.familyMemberId);
      add("externalBeneficiaryIds", b.externalBeneficiaryId);
      add("entityIds", b.entityIdRef);
    }
  };
  for (const ins of plan.inserts) walk(ins.kind, ins.raw);
  for (const u of plan.updates) walk(u.kind, u.set);
  return {
    familyMemberIds: [...found.familyMemberIds],
    externalBeneficiaryIds: [...found.externalBeneficiaryIds],
    entityIds: [...found.entityIds],
    accountIds: [...found.accountIds],
    liabilityIds: [...found.liabilityIds],
  };
}

/** The tenant guard: one scoped read per table (skipped when its list is
 *  empty). Run it BEFORE the promote transaction — see `collectClientRefs`. */
export async function assertRefsInClient(
  clientId: string,
  refs: ClientRefs,
): Promise<FkCheck> {
  const checks = await Promise.all([
    assertFamilyMembersInClient(clientId, refs.familyMemberIds),
    assertExternalBeneficiariesInClient(clientId, refs.externalBeneficiaryIds),
    assertEntitiesInClient(clientId, refs.entityIds),
    assertAccountsInClient(clientId, refs.accountIds),
    assertLiabilitiesInClient(clientId, refs.liabilityIds),
  ]);
  return checks.find((c) => !c.ok) ?? { ok: true };
}
