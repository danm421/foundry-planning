// src/lib/solver/types.ts
//
// Public types shared between the solver UI, API routes, and pure helpers.
// Lives in `src/lib/solver/` so it stays framework-free (no Next, no DB).

import type { ClientData, ProjectionYear } from "@/engine/types";

export type SolverPerson = "client" | "spouse";

export type SsBenefitMode = "pia_at_fra" | "manual_amount" | "no_benefit";
export type SsClaimAgeMode = "fra" | "at_retirement" | "years";

export type SavingsGrowthSource = "custom" | "inflation";

export type IncomeTaxType =
  | "earned_income"
  | "ordinary_income"
  | "dividends"
  | "capital_gains"
  | "qbi"
  | "tax_exempt"
  | "stcg";

export type SolverMutation =
  | { kind: "retirement-age"; person: SolverPerson; age: number; month?: number }
  | { kind: "living-expense-scale"; multiplier: number }
  | { kind: "expense-annual-amount"; expenseId: string; annualAmount: number }
  | { kind: "income-annual-amount"; incomeId: string; annualAmount: number }
  | { kind: "income-growth-rate"; incomeId: string; rate: number }
  | { kind: "income-growth-source"; incomeId: string; source: SavingsGrowthSource }
  | { kind: "income-tax-type"; incomeId: string; taxType: IncomeTaxType }
  | { kind: "income-self-employment"; incomeId: string; value: boolean }
  | { kind: "income-start-year"; incomeId: string; year: number }
  | { kind: "income-end-year"; incomeId: string; year: number }
  | { kind: "ss-claim-age"; person: SolverPerson; age: number; months?: number }
  | { kind: "ss-claim-age-mode"; person: SolverPerson; mode: SsClaimAgeMode }
  | { kind: "ss-benefit-mode"; person: SolverPerson; mode: SsBenefitMode }
  | { kind: "ss-pia-monthly"; person: SolverPerson; amount: number }
  | { kind: "ss-annual-amount"; person: SolverPerson; amount: number }
  | { kind: "ss-cola"; person: SolverPerson; rate: number }
  | { kind: "savings-contribution"; accountId: string; annualAmount: number }
  | { kind: "savings-annual-percent"; accountId: string; percent: number | null }
  | { kind: "savings-roth-percent"; accountId: string; rothPercent: number }
  | { kind: "savings-contribute-max"; accountId: string; value: boolean }
  | { kind: "savings-growth-rate"; accountId: string; rate: number }
  | { kind: "savings-growth-source"; accountId: string; source: SavingsGrowthSource }
  | { kind: "savings-deductible"; accountId: string; value: boolean }
  | { kind: "savings-apply-cap"; accountId: string; value: boolean }
  | {
      kind: "savings-employer-match-pct";
      accountId: string;
      pct: number;
      cap: number | null;
    }
  | { kind: "savings-employer-match-amount"; accountId: string; amount: number }
  | { kind: "savings-start-year"; accountId: string; year: number }
  | { kind: "savings-end-year"; accountId: string; year: number }
  | { kind: "life-expectancy"; person: SolverPerson; age: number };

/** Stable key for "last write per lever wins" upsert semantics. */
export type SolverMutationKey =
  | `retirement-age:${SolverPerson}`
  | "living-expense-scale"
  | `expense-annual-amount:${string}`
  | `income-annual-amount:${string}`
  | `income-growth-rate:${string}`
  | `income-growth-source:${string}`
  | `income-tax-type:${string}`
  | `income-self-employment:${string}`
  | `income-start-year:${string}`
  | `income-end-year:${string}`
  | `ss-claim-age:${SolverPerson}`
  | `ss-claim-age-mode:${SolverPerson}`
  | `ss-benefit-mode:${SolverPerson}`
  | `ss-pia-monthly:${SolverPerson}`
  | `ss-annual-amount:${SolverPerson}`
  | `ss-cola:${SolverPerson}`
  | `savings-contribution:${string}`
  | `savings-annual-percent:${string}`
  | `savings-roth-percent:${string}`
  | `savings-contribute-max:${string}`
  | `savings-growth-rate:${string}`
  | `savings-growth-source:${string}`
  | `savings-deductible:${string}`
  | `savings-apply-cap:${string}`
  | `savings-employer-match-pct:${string}`
  | `savings-employer-match-amount:${string}`
  | `savings-start-year:${string}`
  | `savings-end-year:${string}`
  | `life-expectancy:${SolverPerson}`;

export function mutationKey(m: SolverMutation): SolverMutationKey {
  switch (m.kind) {
    case "retirement-age":
      return `retirement-age:${m.person}`;
    case "living-expense-scale":
      return "living-expense-scale";
    case "expense-annual-amount":
      return `expense-annual-amount:${m.expenseId}`;
    case "income-annual-amount":
      return `income-annual-amount:${m.incomeId}`;
    case "income-growth-rate":
      return `income-growth-rate:${m.incomeId}`;
    case "income-growth-source":
      return `income-growth-source:${m.incomeId}`;
    case "income-tax-type":
      return `income-tax-type:${m.incomeId}`;
    case "income-self-employment":
      return `income-self-employment:${m.incomeId}`;
    case "income-start-year":
      return `income-start-year:${m.incomeId}`;
    case "income-end-year":
      return `income-end-year:${m.incomeId}`;
    case "ss-claim-age":
      return `ss-claim-age:${m.person}`;
    case "ss-claim-age-mode":
      return `ss-claim-age-mode:${m.person}`;
    case "ss-benefit-mode":
      return `ss-benefit-mode:${m.person}`;
    case "ss-pia-monthly":
      return `ss-pia-monthly:${m.person}`;
    case "ss-annual-amount":
      return `ss-annual-amount:${m.person}`;
    case "ss-cola":
      return `ss-cola:${m.person}`;
    case "savings-contribution":
      return `savings-contribution:${m.accountId}`;
    case "savings-annual-percent":
      return `savings-annual-percent:${m.accountId}`;
    case "savings-roth-percent":
      return `savings-roth-percent:${m.accountId}`;
    case "savings-contribute-max":
      return `savings-contribute-max:${m.accountId}`;
    case "savings-growth-rate":
      return `savings-growth-rate:${m.accountId}`;
    case "savings-growth-source":
      return `savings-growth-source:${m.accountId}`;
    case "savings-deductible":
      return `savings-deductible:${m.accountId}`;
    case "savings-apply-cap":
      return `savings-apply-cap:${m.accountId}`;
    case "savings-employer-match-pct":
      return `savings-employer-match-pct:${m.accountId}`;
    case "savings-employer-match-amount":
      return `savings-employer-match-amount:${m.accountId}`;
    case "savings-start-year":
      return `savings-start-year:${m.accountId}`;
    case "savings-end-year":
      return `savings-end-year:${m.accountId}`;
    case "life-expectancy":
      return `life-expectancy:${m.person}`;
  }
}

/**
 * Identifies which scenario the right column of the solver loaded from.
 * "base" = the pristine base plan. Otherwise, a saved scenario uuid.
 */
export type SolverSource = "base" | string;

/** Body shape of POST /api/clients/[id]/solver/project. */
export interface SolverProjectRequest {
  source: SolverSource;
  mutations: SolverMutation[];
}

export interface SolverProjectResponse {
  projection: ProjectionYear[];
}

/** Body shape of POST /api/clients/[id]/solver/save-scenario.
 *  Phase 1 has no notes field — the scenarios table doesn't carry one and
 *  the advisor can add notes via the existing scenario editing UI later. */
export interface SolverSaveRequest {
  source: SolverSource;
  mutations: SolverMutation[];
  name: string;
}

export interface SolverSaveResponse {
  scenarioId: string;
}

/** Internal: a single scenarioChanges row to be inserted, sans scenarioId
 *  (the route fills that in once the new scenarios row exists). */
export interface SolverScenarioChangeDraft {
  opType: "edit";
  targetKind: "client" | "income" | "expense" | "savings_rule";
  targetId: string;
  payload: Record<string, { from: unknown; to: unknown }>;
  orderIndex: number;
}

/** Type guard re-export for `ClientData` so consumers don't need a second import. */
export type { ClientData };
