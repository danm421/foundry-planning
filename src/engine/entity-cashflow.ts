// src/engine/entity-cashflow.ts
import type { ProjectionYear, Income, Expense } from "./types";
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
   *  the business branch to derive per-entity gross income via resolveAmount. */
  incomes: Income[];
  /** The same resolved allExpenses array runProjection built. Same usage. */
  expenses: Expense[];
}

/**
 * Mutates input.years[].entityCashFlow in place, populating one
 * EntityCashFlowRow per entity per year (skipping years where the entity
 * has no presence).
 */
export function computeEntityCashFlow(_input: ComputeEntityCashFlowInput): void {
  // Implemented in subsequent tasks.
}
