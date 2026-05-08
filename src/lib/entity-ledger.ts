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
import { flatBusinessValueAt, type EntityMetadata } from "@/engine/entity-cashflow";
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
  /** Account → entity-owner mapping; same shape the engine consumes. The
   *  aggregator iterates this to find the entity's owned accounts. */
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

  // Pre-filter the household-wide ownership map once. Each section below
  // consumes this same list rather than re-scanning the full map.
  const ownedAccounts: Array<{ accountId: string; share: number; name: string; suffix: string }> = [];
  for (const [accountId, owner] of ctx.accountEntityOwners) {
    if (owner.entityId !== entityId) continue;
    const share = owner.percent;
    const name = ctx.accountNamesById.get(accountId) ?? accountId;
    const suffix = share === 1 ? "" : ` (${(share * 100).toFixed(0)}%)`;
    ownedAccounts.push({ accountId, share, name, suffix });
  }

  const isBusiness = entity.entityType !== "trust";
  if (isBusiness && entity.initialValue > 0) {
    const { growth: flatGrowth } = flatBusinessValueAt(
      entity.initialValue,
      entity.valueGrowthRate,
      ctx.year.year,
      ctx.planStartYear,
    );
    if (flatGrowth !== 0) {
      const g = entity.valueGrowthRate ?? 0;
      growth.push({
        label: `${entity.name} flat value (${(g * 100).toFixed(2)}%)`,
        amount: flatGrowth,
        sourceKind: "flat-business",
        sourceId: entityId,
      });
    }
  }

  let flowDetail: ReturnType<typeof resolveEntityFlows.withDetail> | null = null;
  if (isBusiness) {
    flowDetail = resolveEntityFlows.withDetail(
      entityId,
      ctx.incomes,
      ctx.expenses,
      ctx.year.year,
      ctx.entityFlowOverrides,
      entity.flowMode ?? "annual",
    );
  }

  for (const { accountId, share, name, suffix } of ownedAccounts) {
    const ledger = ctx.year.accountLedgers[accountId];
    if (!ledger) continue;

    const growthContribution = ledger.growth * share;
    if (growthContribution !== 0) {
      growth.push({
        label: `${name}${suffix}`,
        amount: growthContribution,
        sourceKind: "account",
        sourceId: accountId,
      });
    }

    for (const entry of ledger.entries ?? []) {
      if (entry.isInternalTransfer) continue;
      if (entry.category !== "income" && entry.category !== "expense") continue;
      const contribution = Math.abs(entry.amount) * share;
      if (contribution === 0) continue;
      const bucket = entry.category === "income" ? income : expenses;
      bucket.push({
        label: `${name}${suffix} — ${entry.label ?? entry.category}`,
        amount: contribution,
        sourceKind: "account-entry",
        sourceId: `${accountId}:${entry.sourceId ?? entry.label ?? entry.category}`,
      });
    }

    const endingContribution = ledger.endingValue * share;
    if (endingContribution !== 0) {
      ending.push({
        label: `${name}${suffix} — ending`,
        amount: endingContribution,
        sourceKind: "account",
        sourceId: accountId,
      });
    }
  }

  if (flowDetail) {
    for (const r of flowDetail.incomeRows) {
      if (r.amount === 0) continue;
      income.push({
        label: r.name,
        amount: r.amount,
        sourceKind: r.isOverride ? "flow-override" : "flow-base",
        sourceId: r.id,
      });
    }
    for (const r of flowDetail.expenseRows) {
      if (r.amount === 0) continue;
      expenses.push({
        label: r.name,
        amount: r.amount,
        sourceKind: r.isOverride ? "flow-override" : "flow-base",
        sourceId: r.id,
      });
    }
  }

  if (isBusiness && entity.initialValue > 0) {
    const { now: flatNow } = flatBusinessValueAt(
      entity.initialValue,
      entity.valueGrowthRate,
      ctx.year.year,
      ctx.planStartYear,
    );
    if (flatNow !== 0) {
      ending.push({
        label: `${entity.name} flat value (EoY)`,
        amount: flatNow,
        sourceKind: "flat-business",
        sourceId: entityId,
      });
    }
  }

  // Retained earnings is the bridging item that closes the math:
  // row.endingTotalValue = beginningTotalValue + growth + retainedEarnings.
  // The aggregator's ending section is built from EoY snapshots (flat now +
  // account ending) which capture flat growth and account growth. Append
  // the residual as its own row so Σ(ending) reconciles exactly.
  const row = ctx.year.entityCashFlow.get(entityId);
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
