// src/lib/solver/solve-types.ts
//
// Types for the goal-seek solver. Lives alongside the existing solver lib,
// stays framework-free.

import type { ProjectionYear } from "@/engine/types";
import type { SolverMutation, SolverPerson, SolverSource } from "./types";

/** Which lever a solve is targeting. Discriminated union so we can switch
 *  per-kind in lever-search-config and in the SSE route handler. */
export type SolveLeverKey =
  | { kind: "retirement-age"; person: SolverPerson }
  | { kind: "living-expense-scale" }
  | { kind: "savings-contribution"; accountId: string }
  | { kind: "ss-claim-age"; person: SolverPerson }
  | { kind: "roth-conversion-amount"; techniqueId: string };

/** POST /api/clients/[id]/solver/solve body. */
export interface SolveRequest {
  source: SolverSource;
  /** Current non-target mutations from the workspace. The solve will not
   *  iterate on these — they're applied as a baseline. The target lever
   *  (if already in the workspace's mutations map) MUST be filtered out
   *  by the client before sending. */
  mutations: SolverMutation[];
  target: SolveLeverKey;
  /** Target Probability of Success in [0.01, 0.99]. Optional: omitted for the
   *  deterministic ss-claim-age solve, which has no PoS target. */
  targetPoS?: number;
}

/** Emitted per iteration. */
export interface SolveProgressEvent {
  iteration: number;
  candidateValue: number;
  achievedPoS: number;
  /** Which solve phase produced this candidate: the 250-trial search
   *  (including warm-start probes) or the 500-trial refine walk. Optional and
   *  additive for SSE consumers. */
  phase?: "search" | "refine";
}

/** PoS-bisection result (retirement-age, living-expense, savings, roth). */
export interface PoSSolveResult {
  objective: "pos";
  status: "converged" | "unreachable" | "max-iterations";
  solvedValue: number;
  /** PoS at the solved value. The living-expense (max-spend) lever reports this at
   *  the 500-trial refine; every other lever reports it at the 250-trial search. */
  achievedPoS: number;
  /** Kept for API continuity; always equals achievedPoS. There is no separate
   *  1,000-trial confirmation pass — the max-spend lever finalizes at 500 trials,
   *  every other lever at 250. */
  canonicalPoS: number;
  /** Total candidate evaluations across the solve (search + any refine walk) — a
   *  diagnostic count, not the bisection's internal iteration count. */
  iterations: number;
  finalProjection: ProjectionYear[];
  /** MC seed used for the solve. Returned so the client can persist it when saving
   *  the scenario, which lets the saved scenario's report reproduce the same PoS. */
  seed: number;
}

/** Deterministic SS claim-age result: the integer age 62–70 that maximizes the
 *  final-year liquid portfolio. No Monte Carlo, so no PoS / seed. */
export interface EndingPortfolioSolveResult {
  objective: "ending-portfolio";
  status: "converged"; // a max always exists among the candidate ages
  /** Winning claim age. */
  solvedValue: number;
  /** Winning age's final-year portfolioAssets.liquidTotal. */
  endingPortfolio: number;
  /** Every candidate age with its final-year liquidTotal, for display/debug. */
  candidates: { value: number; endingPortfolio: number }[];
  /** Winning age's deterministic projection. */
  finalProjection: ProjectionYear[];
}

/** Terminal event — always exactly one per stream. */
export type SolveResultEvent = PoSSolveResult | EndingPortfolioSolveResult;

/** Server-side fatal error. */
export interface SolveErrorEvent {
  message: string;
}

/** Server-Sent Event names emitted by the /solver/solve route. */
export type SolveSseEventName = "progress" | "result" | "error";
