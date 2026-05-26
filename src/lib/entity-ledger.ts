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
  Account,
  AccountFlowOverride,
  ClientInfo,
  EntityFlowOverride,
  Expense,
  Income,
  ProjectionYear,
} from "@/engine/types";
import {
  flatBusinessValueAt,
  type BusinessAccountMetadata,
  type EntityMetadata,
} from "@/engine/entity-cashflow";
import { resolveEntityFlows } from "@/engine/entity-flows";
import { collectBusinessTree } from "@/engine/business/business-tree";

export type LedgerSection = "growth" | "income" | "expenses" | "ending";

export type LedgerSourceKind =
  | "flat-business"
  | "account"
  | "flow-base"
  | "flow-override"
  | "account-entry"
  /** Ending-section anchor row: beginning-of-year balance the deltas accrete on. */
  | "walk-anchor"
  /** Ending-section signed delta (growth, income +, expenses −, distributions −, etc). */
  | "walk-flow";

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
  /** Top-level business-account metadata, keyed by account id. When the
   *  selected dropdown id matches a key here (and not an entity), the
   *  ledger routes through the account branch instead. */
  businessAccountsById?: Map<string, BusinessAccountMetadata>;
  /** All accounts. Required for the account branch to walk each business's
   *  parent+children tree. Optional so legacy entity-only callers compile. */
  accounts?: Account[];
  incomes: Income[];
  expenses: Expense[];
  entityFlowOverrides: EntityFlowOverride[];
  /** Per-year (income, expense, distribution%) override grid for business
   *  accounts in schedule mode. */
  accountFlowOverrides?: AccountFlowOverride[];
  /** Optional. Enables retirement-month proration on the no-override
   *  growth-mode fallback inside resolveEntityFlowAmount, matching the
   *  engine's per-row crediting in the projection. */
  client?: ClientInfo;
}

export function getEntityLedger(
  entityId: string,
  ctx: EntityLedgerContext,
): EntityLedger {
  const entity = ctx.entitiesById.get(entityId);
  if (!entity) {
    // Account-as-asset branch: when the dropdown selection is a top-level
    // business account id rather than an entity id, build the ledger from
    // the account tree + computeBusinessYearFlow.
    const bizAcct = ctx.businessAccountsById?.get(entityId);
    if (bizAcct && ctx.accounts) {
      return getBusinessAccountLedger(entityId, bizAcct, ctx as EntityLedgerContext & { accounts: Account[] });
    }
    return { growth: [], income: [], expenses: [], ending: [] };
  }

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
      ctx.client,
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

    // Account-entry flow contributions are only attributable to the entity
    // when it owns the account fully. On split-owned accounts, flows are
    // household-driven (the engine locks the entity's share to BoY + growth).
    if (share !== 1) continue;
    for (const entry of ledger.entries ?? []) {
      if (entry.isInternalTransfer) continue;
      if (entry.category !== "income" && entry.category !== "expense") continue;
      const contribution = Math.abs(entry.amount);
      if (contribution === 0) continue;
      const bucket = entry.category === "income" ? income : expenses;
      bucket.push({
        label: `${name} — ${entry.label ?? entry.category}`,
        amount: contribution,
        sourceKind: "account-entry",
        sourceId: `${accountId}:${entry.sourceId ?? entry.label ?? entry.category}`,
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

  // ── Ending section: year-walk (BoY + signed flows = EoY) ──────────────
  const row = ctx.year.entityCashFlow.get(entityId);
  if (row?.kind === "business") {
    ending.push({
      label: "Beginning of year",
      amount: row.beginningTotalValue,
      sourceKind: "walk-anchor",
      sourceId: `${entityId}:boy`,
    });
    if (row.growth !== 0) {
      ending.push({
        label: "Business growth",
        amount: row.growth,
        sourceKind: "walk-flow",
        sourceId: `${entityId}:growth`,
      });
    }
    if (row.income !== 0) {
      ending.push({
        label: "Business income",
        amount: row.income,
        sourceKind: "walk-flow",
        sourceId: `${entityId}:income`,
      });
    }
    if (row.expenses !== 0) {
      ending.push({
        label: "Business expenses",
        amount: -row.expenses,
        sourceKind: "walk-flow",
        sourceId: `${entityId}:expenses`,
      });
    }
    if (row.annualDistribution !== 0) {
      ending.push({
        label: "Annual distribution",
        amount: -row.annualDistribution,
        sourceKind: "walk-flow",
        sourceId: `${entityId}:distribution`,
      });
    }
  } else if (row?.kind === "trust") {
    // Trust ending balance is a snapshot of held-account ending values.
    // The trust's row income/expenses/taxes/distributions are descriptive
    // rollups that already net through the account ledgers — surfacing them
    // again as walk deltas would double-count. Show the snapshot instead.
    for (const { accountId, share, name, suffix } of ownedAccounts) {
      const ledger = ctx.year.accountLedgers[accountId];
      if (!ledger) continue;
      const contribution = ledger.endingValue * share;
      if (contribution === 0) continue;
      ending.push({
        label: `${name}${suffix} — ending`,
        amount: contribution,
        sourceKind: "account",
        sourceId: accountId,
      });
    }
  }

  return { growth, income, expenses, ending };
}

/** Account-as-asset ledger drill-down. Growth is rolled up across the
 *  business tree (parent + descendants); income/expense come from each
 *  income/expense row tagged with `ownerAccountId`, OR — in schedule mode —
 *  from a single synthetic row sourced from `accountFlowOverrides`. */
function getBusinessAccountLedger(
  accountId: string,
  biz: BusinessAccountMetadata,
  ctx: EntityLedgerContext & { accounts: Account[] },
): EntityLedger {
  const growth: LedgerSourceRow[] = [];
  const income: LedgerSourceRow[] = [];
  const expenses: LedgerSourceRow[] = [];
  const ending: LedgerSourceRow[] = [];

  // Per-account growth rows across the business tree. Mirrors the
  // owned-account loop the entity branch uses, but the tree includes every
  // descendant — child cash buckets, sub-investments, etc.
  const tree = collectBusinessTree(accountId, ctx.accounts);
  for (const a of tree) {
    const ledger = ctx.year.accountLedgers[a.id];
    if (!ledger) continue;
    if (ledger.growth === 0) continue;
    growth.push({
      label: a.name,
      amount: ledger.growth,
      sourceKind: "account",
      sourceId: a.id,
    });
  }

  // Schedule mode: a single override cell is the source of truth for the
  // year's income/expense — same model as schedule-mode entities.
  const flowMode = biz.flowMode ?? "annual";
  if (flowMode === "schedule") {
    const ovr = (ctx.accountFlowOverrides ?? []).find(
      (o) => o.accountId === accountId && o.year === ctx.year.year,
    );
    if (ovr?.incomeAmount != null && ovr.incomeAmount !== 0) {
      income.push({
        label: "Schedule income",
        amount: ovr.incomeAmount,
        sourceKind: "flow-override",
        sourceId: `schedule:${accountId}:${ctx.year.year}:income`,
      });
    }
    if (ovr?.expenseAmount != null && ovr.expenseAmount !== 0) {
      expenses.push({
        label: "Schedule expense",
        amount: ovr.expenseAmount,
        sourceKind: "flow-override",
        sourceId: `schedule:${accountId}:${ctx.year.year}:expense`,
      });
    }
  } else {
    // Annual mode: enumerate each income/expense row tagged with the
    // business as its owner so the drill-down lists by source. Sums match
    // computeBusinessYearFlow's `gross` / `exp`.
    const y = ctx.year.year;
    for (const inc of ctx.incomes) {
      if (inc.ownerAccountId !== accountId) continue;
      if (y < inc.startYear || y > inc.endYear) continue;
      const inflateFrom = inc.inflationStartYear ?? inc.startYear;
      const amount = inc.annualAmount * Math.pow(1 + inc.growthRate, y - inflateFrom);
      if (amount === 0) continue;
      income.push({
        label: inc.name,
        amount,
        sourceKind: "flow-base",
        sourceId: inc.id,
      });
    }
    for (const exp of ctx.expenses) {
      if (exp.ownerAccountId !== accountId) continue;
      if (y < exp.startYear || y > exp.endYear) continue;
      const inflateFrom = exp.inflationStartYear ?? exp.startYear;
      const amount = exp.annualAmount * Math.pow(1 + exp.growthRate, y - inflateFrom);
      if (amount === 0) continue;
      expenses.push({
        label: exp.name,
        amount,
        sourceKind: "flow-base",
        sourceId: exp.id,
      });
    }
  }

  // Ending section: year-walk BoY → growth → income − expenses − distribution.
  // Same shape as the entity-business branch so the modal renders identically.
  const row = ctx.year.entityCashFlow.get(accountId);
  if (row?.kind === "business") {
    ending.push({
      label: "Beginning of year",
      amount: row.beginningTotalValue,
      sourceKind: "walk-anchor",
      sourceId: `${accountId}:boy`,
    });
    if (row.growth !== 0) {
      ending.push({
        label: "Business growth",
        amount: row.growth,
        sourceKind: "walk-flow",
        sourceId: `${accountId}:growth`,
      });
    }
    if (row.income !== 0) {
      ending.push({
        label: "Business income",
        amount: row.income,
        sourceKind: "walk-flow",
        sourceId: `${accountId}:income`,
      });
    }
    if (row.expenses !== 0) {
      ending.push({
        label: "Business expenses",
        amount: -row.expenses,
        sourceKind: "walk-flow",
        sourceId: `${accountId}:expenses`,
      });
    }
    if (row.annualDistribution !== 0) {
      ending.push({
        label: "Annual distribution",
        amount: -row.annualDistribution,
        sourceKind: "walk-flow",
        sourceId: `${accountId}:distribution`,
      });
    }
  }

  return { growth, income, expenses, ending };
}
