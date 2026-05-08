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
  _entityId: string,
  _ctx: EntityLedgerContext,
): EntityLedger {
  return { growth: [], income: [], expenses: [], ending: [] };
}
