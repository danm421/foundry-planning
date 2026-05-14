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
  | { kind: "ss-claim-age"; person: SolverPerson };

/** POST /api/clients/[id]/solver/solve body. */
export interface SolveRequest {
  source: SolverSource;
  /** Current non-target mutations from the workspace. The solve will not
   *  iterate on these — they're applied as a baseline. The target lever
   *  (if already in the workspace's mutations map) MUST be filtered out
   *  by the client before sending. */
  mutations: SolverMutation[];
  target: SolveLeverKey;
  /** Target Probability of Success in [0.01, 0.99]. */
  targetPoS: number;
}

/** Emitted per iteration. */
export interface SolveProgressEvent {
  iteration: number;
  candidateValue: number;
  achievedPoS: number;
}

/** Terminal event — always exactly one per stream. */
export interface SolveResultEvent {
  status: "converged" | "unreachable" | "max-iterations";
  solvedValue: number;
  achievedPoS: number;
  iterations: number;
  finalProjection: ProjectionYear[];
}

/** Server-side fatal error. */
export interface SolveErrorEvent {
  message: string;
}

/** Server-Sent Event names emitted by the /solver/solve route. */
export type SolveSseEventName = "progress" | "result" | "error";
