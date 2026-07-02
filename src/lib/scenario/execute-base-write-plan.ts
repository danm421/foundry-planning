// src/lib/scenario/execute-base-write-plan.ts
//
// IO. Applies a BaseWritePlan to the base-case rows inside an open transaction.
// FK-safe order: insert parents (accounts first) → other inserts → updates →
// singleton updates → removes (children/cascades cleared by DB ON DELETE
// CASCADE). Synthetic add ids are remapped to DB-generated uuids so dependent
// references resolve. Scope columns (clientId, scenarioId) are injected and
// matched ONLY when the target table actually has them — most base tables are
// scenario-scoped, but a few (e.g. the client-scoped `gifts` table) are not.
// Mirrors save-to-base's security posture: every statement is scoped to the
// base scenario / client it owns.
import { and, eq, getTableColumns } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { clients, planSettings } from "@/db/schema";
import type { BaseWritePlan } from "./promote-to-base-types";
import { PROMOTE_TABLE_REGISTRY, type PromoteTx } from "./promote-table-registry";
import { coerceForTable } from "./promote-coerce";

interface ExecCtx {
  clientId: string;
  baseScenarioId: string;
}

/** Columns on dependent rows that reference an account/parent id and must be
 *  remapped when that parent was inserted in this batch with a synthetic id. */
const REF_COLUMNS = [
  "accountId",
  "sourceAccountId",
  "targetAccountId",
  "destinationAccountId",
  "proceedsAccountId",
  "parentAccountId",
  "surplusSaveAccountId",
];

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
  // expense's dedicatedAccountIds pointing at an account added in this plan)
  // through the shared idRemap — populated account-first by the sort below.
  const childCtx = { clientId: ctx.clientId, baseScenarioId: ctx.baseScenarioId, idRemap };

  // Insert accounts first (most things FK to them), then everything else.
  const inserts = [...plan.inserts].sort(
    (a, b) => (a.kind === "account" ? 0 : 1) - (b.kind === "account" ? 0 : 1),
  );
  for (const ins of inserts) {
    const entry = PROMOTE_TABLE_REGISTRY[ins.kind];
    if (!entry) throw new Error(`promote: no table for kind ${ins.kind}`);
    const cols = getTableColumns(entry.table) as Cols;
    const remapped = remapRefs(ins.raw, idRemap);
    const values: Record<string, unknown> = {
      ...coerceForTable(entry.table, remapped),
      ...scopeValues(cols, ctx),
    };
    delete values.id; // let the DB generate a fresh uuid
    const [row] = await tx
      .insert(entry.table)
      .values(values as never)
      .returning({ id: cols.id });
    const newId = (row as { id: string }).id;
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
