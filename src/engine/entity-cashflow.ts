// src/engine/entity-cashflow.ts
import type { ProjectionYear, Income, Expense, EntityFlowMode, EntityFlowOverride } from "./types";
import { resolveEntityFlows } from "./entity-flows";
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
  flowMode?: EntityFlowMode;
  /** Annual compound growth rate applied to `initialValue`. Null/undefined
   *  means 0 (no growth — preserves the pre-2026 flat-value behavior).
   *  Business-entity only. */
  valueGrowthRate?: number | null;
}

/** Compound a business entity's flat valuation forward to year-N. The "+1"
 *  offset means year 0 (planStartYear) reports EoY of year 0 = initialValue × (1+g),
 *  matching how account ledgers grow (BoY → growth → EoY). */
export function flatBusinessValueAt(
  initialValue: number,
  growthRate: number | null | undefined,
  year: number,
  planStartYear: number,
): { prior: number; now: number; growth: number } {
  const yrs = year - planStartYear;
  const g = growthRate ?? 0;
  const prior = initialValue * Math.pow(1 + g, yrs);
  const now = initialValue * Math.pow(1 + g, yrs + 1);
  return { prior, now, growth: now - prior };
}

export interface ComputeEntityCashFlowInput {
  years: ProjectionYear[];
  /** Entity metadata indexed by id. */
  entitiesById: Map<string, EntityMetadata>;
  /** Account → entity-owner mapping. Split ownership is supported: the
   *  account contributes to the entity rollup proportionally to `percent`. */
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

  // Build entity → account list. Split ownership is allowed; share is applied
  // during the rollup so a 60/40 entity/personal account contributes 60% to
  // the entity row.
  const accountsByEntity = new Map<string, string[]>();
  for (const [accountId, owner] of accountEntityOwners) {
    const list = accountsByEntity.get(owner.entityId) ?? [];
    list.push(accountId);
    accountsByEntity.set(owner.entityId, list);
  }

  const planStart = years[0]?.year ?? 0;

  // Per-entity per-account locked EoY share for split-owned accounts. Carries
  // year-over-year so household-driven flows on the joint account never bleed
  // into the entity's reported share.
  const lockedShareByEntityAccount = new Map<string, Map<string, number>>();

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
        const owner = accountEntityOwners.get(aid);
        const share = owner?.percent ?? 1;
        if (share === 1) {
          // Fully entity-owned — the account's full activity belongs to the entity.
          beginningBalance += ledger.beginningValue;
          endingBalance += ledger.endingValue;
          growth += ledger.growth;
          for (const entry of ledger.entries) {
            if (entry.isInternalTransfer) continue;
            if (entry.category === "income") income += Math.abs(entry.amount);
            if (entry.category === "expense") expenses += Math.abs(entry.amount);
          }
        } else {
          // Split-owned — entity's share is locked to (carried EoY share or
          // initial BoY × percent) plus its share of passive growth. Flow
          // entries on the account are treated as household-attributable.
          const carried = lockedShareByEntityAccount.get(entityId)?.get(aid);
          const lockedBoY = carried ?? ledger.beginningValue * share;
          const lockedGrowth = ledger.growth * share;
          const lockedEoY = lockedBoY + lockedGrowth;
          beginningBalance += lockedBoY;
          endingBalance += lockedEoY;
          growth += lockedGrowth;
          if (!lockedShareByEntityAccount.has(entityId)) {
            lockedShareByEntityAccount.set(entityId, new Map());
          }
          lockedShareByEntityAccount.get(entityId)!.set(aid, lockedEoY);
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
        const { prior: flatValuePrior, growth: flatGrowthThisYear } =
          flatBusinessValueAt(entity.initialValue, entity.valueGrowthRate, year.year, planStart);
        const beginningTotalValue = flatValuePrior + beginningBalance;
        const totalGrowth = growth + flatGrowthThisYear;

        // Derive per-entity gross income/expenses via resolveEntityFlows so
        // Phase 2 per-year overrides win + the same inflate-from convention
        // applies as in computeBusinessEntityNetIncome. Schedule mode reads
        // the override grid directly (no base row required).
        const flowMode = entity.flowMode ?? "annual";
        const { income: bizIncome, expense: bizExpenses } = resolveEntityFlows(
          entityId,
          input.incomes,
          input.expenses,
          year.year,
          input.entityFlowOverrides,
          flowMode,
        );

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
