// src/lib/solver/types.ts
//
// Public types shared between the solver UI, API routes, and pure helpers.
// Lives in `src/lib/solver/` so it stays framework-free (no Next, no DB).

import type { ClientData, ProjectionYear } from "@/engine/types";

export type SolverPerson = "client" | "spouse";

export type SolverMutation =
  | { kind: "retirement-age"; person: SolverPerson; age: number; month?: number }
  | { kind: "living-expense-scale"; multiplier: number }
  | { kind: "ss-claim-age"; person: SolverPerson; age: number }
  | { kind: "savings-contribution"; accountId: string; annualAmount: number }
  | { kind: "life-expectancy"; person: SolverPerson; age: number };

/** Stable key for "last write per lever wins" upsert semantics. */
export type SolverMutationKey =
  | `retirement-age:${SolverPerson}`
  | "living-expense-scale"
  | `ss-claim-age:${SolverPerson}`
  | `savings-contribution:${string}`
  | `life-expectancy:${SolverPerson}`;

export function mutationKey(m: SolverMutation): SolverMutationKey {
  switch (m.kind) {
    case "retirement-age":
      return `retirement-age:${m.person}`;
    case "living-expense-scale":
      return "living-expense-scale";
    case "ss-claim-age":
      return `ss-claim-age:${m.person}`;
    case "savings-contribution":
      return `savings-contribution:${m.accountId}`;
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
