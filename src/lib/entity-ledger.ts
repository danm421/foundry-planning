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

  return { growth, income, expenses, ending };
}
