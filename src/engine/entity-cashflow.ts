// src/engine/entity-cashflow.ts
import type { ProjectionYear, Income, Expense, EntityFlowOverride } from "./types";
import { resolveEntityFlowAmount } from "./entity-flows";
import type { trustSubTypeEnum } from "@/db/schema";

type TrustSubType = (typeof trustSubTypeEnum.enumValues)[number];

interface BaseEntityCashFlowRow {
  entityId: string;
  entityName: string;
  year: number;
  ages: { client: number; spouse?: number };
}

export interface TrustCashFlowRow extends BaseEntityCashFlowRow {
  kind: "trust";
  trustSubType: TrustSubType;
  isGrantor: boolean;
  beginningBalance: number;
  transfersIn: number;
  growth: number;
  income: number;
  totalDistributions: number;
  expenses: number;
  taxes: number;
  endingBalance: number;
}

export interface BusinessCashFlowRow extends BaseEntityCashFlowRow {
  kind: "business";
  entityType: "llc" | "s_corp" | "c_corp" | "partnership" | "foundation" | "other";
  beginningTotalValue: number;
  beginningBasis: number;
  growth: number;
  income: number;
  expenses: number;
  annualDistribution: number;
  retainedEarnings: number;
  endingTotalValue: number;
  endingBasis: number;
}

export type EntityCashFlowRow = TrustCashFlowRow | BusinessCashFlowRow;

export interface EntityMetadata {
  id: string;
  name: string;
  entityType: "trust" | "llc" | "s_corp" | "c_corp" | "partnership" | "foundation" | "other";
  trustSubType: TrustSubType | null;
  isGrantor: boolean;
  /** entities.value at plan start. Only meaningful for businesses. */
  initialValue: number;
  initialBasis: number;
}

export interface ComputeEntityCashFlowInput {
  years: ProjectionYear[];
  /** Entity metadata indexed by id. */
  entitiesById: Map<string, EntityMetadata>;
  /** Account → entity-owner mapping. Only entries where percent === 1
   *  belong to the entity rollup. */
  accountEntityOwners: Map<string, { entityId: string; percent: number }>;
  /** Gifts to entities, grouped by recipient entity id and year. */
  giftsByEntityYear: Map<string, Map<number, number>>;
  /** The same resolved currentIncomes array runProjection built. Used by
   *  the business branch to derive per-entity gross income via
   *  resolveEntityFlowAmount (Phase 2 overrides win). */
  incomes: Income[];
  /** The same resolved allExpenses array runProjection built. Same usage. */
  expenses: Expense[];
  /** Phase 2 entity flow overrides (per-entity per-year sparse cells).
   *  Pass-through to resolveEntityFlowAmount so the business branch picks
   *  up Schedule-grid edits the same way the engine does. */
  entityFlowOverrides: EntityFlowOverride[];
}

/**
 * Mutates input.years[].entityCashFlow in place, populating one
 * EntityCashFlowRow per entity per year (skipping years where the entity
 * has no presence).
 */
export function computeEntityCashFlow(input: ComputeEntityCashFlowInput): void {
  const { years, entitiesById, accountEntityOwners } = input;

  // Build entity → account list (only percent === 1 entries belong to the entity)
  const accountsByEntity = new Map<string, string[]>();
  for (const [accountId, owner] of accountEntityOwners) {
    if (owner.percent !== 1) continue;
    const list = accountsByEntity.get(owner.entityId) ?? [];
    list.push(accountId);
    accountsByEntity.set(owner.entityId, list);
  }

  for (const year of years) {
    for (const [entityId, entity] of entitiesById) {
      const accountIds = accountsByEntity.get(entityId) ?? [];
      let beginningBalance = 0;
      let endingBalance = 0;
      let growth = 0;
      let income = 0;
      let expenses = 0;
      for (const aid of accountIds) {
        const ledger = year.accountLedgers[aid];
        if (!ledger) continue;
        beginningBalance += ledger.beginningValue;
        endingBalance += ledger.endingValue;
        growth += ledger.growth;
        for (const entry of ledger.entries) {
          if (entry.isInternalTransfer) continue;
          if (entry.category === "income") income += Math.abs(entry.amount);
          if (entry.category === "expense") expenses += Math.abs(entry.amount);
        }
      }
      let totalDistributions = year.trustDistributionsByEntity?.get(entityId) ?? 0;
      if (entity.entityType === "trust") {
        for (const o of year.charitableOutflowDetail ?? []) {
          if (o.trustId === entityId) totalDistributions += o.amount;
        }
        for (const t of year.trustTerminations ?? []) {
          if (t.trustId === entityId) totalDistributions += t.totalDistributed;
        }
      }

      let transfersIn = 0;
      if (entity.entityType === "trust") {
        const giftsForEntity = input.giftsByEntityYear.get(entityId);
        if (giftsForEntity) transfersIn += giftsForEntity.get(year.year) ?? 0;
        for (const t of year.deathTransfers ?? []) {
          if (t.recipientKind === "entity" && t.recipientId === entityId) {
            transfersIn += t.amount;
          }
        }
      }

      let taxes = 0;
      if (entity.entityType === "trust" && !entity.isGrantor) {
        const tt = year.trustTaxByEntity?.get(entityId);
        if (tt) taxes = tt.total;
      }

      if (entity.entityType === "trust") {
        year.entityCashFlow.set(entityId, {
          kind: "trust",
          entityId,
          entityName: entity.name,
          year: year.year,
          ages: year.ages,
          trustSubType: entity.trustSubType ?? "irrevocable",
          isGrantor: entity.isGrantor,
          beginningBalance,
          transfersIn,
          growth,
          income,
          totalDistributions,
          expenses,
          taxes,
          endingBalance,
        });
      } else {
        // Business branch: llc | s_corp | c_corp | partnership | foundation | other.
        // Flat-value growth is 0 in v1 — see "Out of scope" in the spec.
        const beginningTotalValue = entity.initialValue + beginningBalance;
        const totalGrowth = growth; // entity-owned account growth only

        // Derive per-entity gross income/expenses via resolveEntityFlowAmount
        // so Phase 2 per-year overrides win + the same inflate-from convention
        // applies as in computeBusinessEntityNetIncome.
        let bizIncome = 0;
        let bizExpenses = 0;
        for (const inc of input.incomes) {
          if (inc.ownerEntityId !== entityId) continue;
          bizIncome += resolveEntityFlowAmount(inc, entityId, "income", year.year, input.entityFlowOverrides);
        }
        for (const exp of input.expenses) {
          if (exp.ownerEntityId !== entityId) continue;
          bizExpenses += resolveEntityFlowAmount(exp, entityId, "expense", year.year, input.entityFlowOverrides);
        }

        // Annual distribution = sum of |entity_distribution| debits on entity-owned
        // accounts. The engine writes a debit on entity checking and a credit on
        // household checking (Phase 3 wiring); this side reads the entity-side debit.
        let annualDistribution = 0;
        for (const aid of accountIds) {
          const ledger = year.accountLedgers[aid];
          if (!ledger) continue;
          for (const entry of ledger.entries) {
            if (entry.category !== "entity_distribution") continue;
            if (entry.amount < 0) annualDistribution += Math.abs(entry.amount);
          }
        }

        const netIncome = bizIncome - bizExpenses;
        const retainedEarnings = netIncome - annualDistribution;
        const endingTotalValue = beginningTotalValue + totalGrowth + retainedEarnings;
        const beginningBasis = entity.initialBasis;

        year.entityCashFlow.set(entityId, {
          kind: "business",
          entityId,
          entityName: entity.name,
          year: year.year,
          ages: year.ages,
          entityType: entity.entityType,
          beginningTotalValue,
          beginningBasis,
          growth: totalGrowth,
          income: bizIncome,
          expenses: bizExpenses,
          annualDistribution,
          retainedEarnings,
          endingTotalValue,
          endingBasis: beginningBasis, // basis-altering events out-of-scope for v1
        });
      }
    }
  }
}
