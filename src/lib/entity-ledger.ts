// src/lib/entity-ledger.ts
//
// Read-only aggregator that re-emits per-source contributions for an entity's
// growth, income, expenses, and ending value in a given projection year. The
// per-section sums are guaranteed to equal the matching field on
// year.entityCashFlow.get(entityId) — see entity-ledger.test.ts.
//
// Lives in src/lib/ (not src/engine/) because it depends on engine output
// plus label lookups (account names, flow labels).

import type {
  ProjectionYear,
  Income,
  Expense,
  EntityFlowOverride,
} from "@/engine/types";
import type { EntityMetadata } from "@/engine/entity-cashflow";
import { resolveEntityFlows } from "@/engine/entity-flows";

export type LedgerSection = "growth" | "income" | "expenses" | "ending";

export type LedgerSourceKind =
  | "flat-business"
  | "account"
  | "flow-base"
  | "flow-override"
  | "account-entry";

export interface LedgerSourceRow {
  label: string;
  amount: number;
  sourceKind: LedgerSourceKind;
  sourceId?: string;
}

export interface EntityLedger {
  growth: LedgerSourceRow[];
  income: LedgerSourceRow[];
  expenses: LedgerSourceRow[];
  ending: LedgerSourceRow[];
}

export interface EntityLedgerContext {
  year: ProjectionYear;
  /** Plan's first projection year — used to compute the flat-business
   *  compounding exponent (year - planStartYear). */
  planStartYear: number;
  entitiesById: Map<string, EntityMetadata>;
  accountNamesById: Map<string, string>;
  accountEntityOwners: Map<string, { entityId: string; percent: number }>;
  incomes: Income[];
  expenses: Expense[];
  entityFlowOverrides: EntityFlowOverride[];
}

export function getEntityLedger(
  entityId: string,
  ctx: EntityLedgerContext,
): EntityLedger {
  const entity = ctx.entitiesById.get(entityId);
  if (!entity) return { growth: [], income: [], expenses: [], ending: [] };

  const growth: LedgerSourceRow[] = [];
  const income: LedgerSourceRow[] = [];
  const expenses: LedgerSourceRow[] = [];
  const ending: LedgerSourceRow[] = [];

  const isBusiness = entity.entityType !== "trust";
  if (isBusiness && entity.initialValue > 0) {
    const yrs = ctx.year.year - ctx.planStartYear;
    const g = entity.valueGrowthRate ?? 0;
    const flatPrior = entity.initialValue * Math.pow(1 + g, yrs);
    const flatNow = entity.initialValue * Math.pow(1 + g, yrs + 1);
    const flatGrowth = flatNow - flatPrior;
    if (flatGrowth !== 0) {
      growth.push({
        label: `${entity.name} flat value (${(g * 100).toFixed(2)}%)`,
        amount: flatGrowth,
        sourceKind: "flat-business",
        sourceId: entityId,
      });
    }
  }

  for (const [accountId, owner] of ctx.accountEntityOwners) {
    if (owner.entityId !== entityId) continue;
    const ledger = ctx.year.accountLedgers[accountId];
    if (!ledger) continue;
    const share = owner.percent;
    const contribution = ledger.growth * share;
    if (contribution !== 0) {
      const name = ctx.accountNamesById.get(accountId) ?? accountId;
      const suffix = share === 1 ? "" : ` (${(share * 100).toFixed(0)}%)`;
      growth.push({
        label: `${name}${suffix}`,
        amount: contribution,
        sourceKind: "account",
        sourceId: accountId,
      });
    }
  }

  if (isBusiness) {
    const flowMode = entity.flowMode ?? "annual";
    const { incomeRows } = resolveEntityFlows.withDetail(
      entityId,
      ctx.incomes,
      ctx.expenses,
      ctx.year.year,
      ctx.entityFlowOverrides,
      flowMode,
    );
    for (const r of incomeRows) {
      if (r.amount === 0) continue;
      income.push({
        label: r.name,
        amount: r.amount,
        sourceKind: r.isOverride ? "flow-override" : "flow-base",
        sourceId: r.id,
      });
    }
  }

  for (const [accountId, owner] of ctx.accountEntityOwners) {
    if (owner.entityId !== entityId) continue;
    const acctLedger = ctx.year.accountLedgers[accountId];
    if (!acctLedger) continue;
    const share = owner.percent;
    for (const entry of acctLedger.entries ?? []) {
      if (entry.isInternalTransfer) continue;
      if (entry.category !== "income") continue;
      const contribution = Math.abs(entry.amount) * share;
      if (contribution === 0) continue;
      const name = ctx.accountNamesById.get(accountId) ?? accountId;
      const suffix = share === 1 ? "" : ` (${(share * 100).toFixed(0)}%)`;
      income.push({
        label: `${name}${suffix} — ${entry.label ?? "income"}`,
        amount: contribution,
        sourceKind: "account-entry",
        sourceId: `${accountId}:${entry.sourceId ?? entry.label ?? "income"}`,
      });
    }
  }

  if (isBusiness) {
    const flowMode = entity.flowMode ?? "annual";
    const { expenseRows } = resolveEntityFlows.withDetail(
      entityId,
      ctx.incomes,
      ctx.expenses,
      ctx.year.year,
      ctx.entityFlowOverrides,
      flowMode,
    );
    for (const r of expenseRows) {
      if (r.amount === 0) continue;
      expenses.push({
        label: r.name,
        amount: r.amount,
        sourceKind: r.isOverride ? "flow-override" : "flow-base",
        sourceId: r.id,
      });
    }
  }

  for (const [accountId, owner] of ctx.accountEntityOwners) {
    if (owner.entityId !== entityId) continue;
    const acctLedger = ctx.year.accountLedgers[accountId];
    if (!acctLedger) continue;
    const share = owner.percent;
    for (const entry of acctLedger.entries ?? []) {
      if (entry.isInternalTransfer) continue;
      if (entry.category !== "expense") continue;
      const contribution = Math.abs(entry.amount) * share;
      if (contribution === 0) continue;
      const name = ctx.accountNamesById.get(accountId) ?? accountId;
      const suffix = share === 1 ? "" : ` (${(share * 100).toFixed(0)}%)`;
      expenses.push({
        label: `${name}${suffix} — ${entry.label ?? "expense"}`,
        amount: contribution,
        sourceKind: "account-entry",
        sourceId: `${accountId}:${entry.sourceId ?? entry.label ?? "expense"}`,
      });
    }
  }

  const row = ctx.year.entityCashFlow.get(entityId);

  if (isBusiness && entity.initialValue > 0) {
    const yrs = ctx.year.year - ctx.planStartYear;
    const g = entity.valueGrowthRate ?? 0;
    const flatNow = entity.initialValue * Math.pow(1 + g, yrs + 1);
    if (flatNow !== 0) {
      ending.push({
        label: `${entity.name} flat value (EoY)`,
        amount: flatNow,
        sourceKind: "flat-business",
        sourceId: entityId,
      });
    }
  }

  for (const [accountId, owner] of ctx.accountEntityOwners) {
    if (owner.entityId !== entityId) continue;
    const acctLedger = ctx.year.accountLedgers[accountId];
    if (!acctLedger) continue;
    const share = owner.percent;
    const contribution = acctLedger.endingValue * share;
    if (contribution === 0) continue;
    const name = ctx.accountNamesById.get(accountId) ?? accountId;
    const suffix = share === 1 ? "" : ` (${(share * 100).toFixed(0)}%)`;
    ending.push({
      label: `${name}${suffix} — ending`,
      amount: contribution,
      sourceKind: "account",
      sourceId: accountId,
    });
  }

  // Retained earnings is the bridging item that closes the math:
  // row.endingTotalValue = beginningTotalValue + growth + retainedEarnings.
  // The aggregator's ending section is built from EoY snapshots (flat now +
  // account ending) which capture flat growth and account growth. To match
  // the invariant exactly, append the retained earnings as its own row.
  if (row?.kind === "business" && row.retainedEarnings !== 0) {
    const sumSoFar = ending.reduce((a, r) => a + r.amount, 0);
    const gap = row.endingTotalValue - sumSoFar;
    if (Math.abs(gap) > 0.01) {
      ending.push({
        label: "Retained earnings",
        amount: gap,
        sourceKind: "flat-business",
        sourceId: entityId,
      });
    }
  }

  return { growth, income, expenses, ending };
}
