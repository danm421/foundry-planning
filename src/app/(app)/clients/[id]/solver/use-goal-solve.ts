// src/app/(app)/clients/[id]/solver/use-goal-solve.ts
"use client";

import { useCallback, useRef, useState } from "react";
import type { SolverMutation } from "@/lib/solver/types";

export interface GoalSolveOutput {
  additionalAnnual: number;
  reachesTarget: boolean;
  /** Echoed back by the route (clamped), so the caller labels the result with
   *  the target the search actually used — not one edited since. */
  targetPct: number;
}

export function useGoalSolve(args: {
  clientId: string;
  source: string;
  mutations: SolverMutation[];
  /** The year the caller applies results in. The route solves in it too, so
   *  both sides pick the same savings rule (`goalContributionRule`). */
  currentYear: number;
}) {
  const { clientId, source, mutations, currentYear } = args;
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  // Read the latest mutations at call time without re-creating `run`.
  const mutationsRef = useRef(mutations);
  mutationsRef.current = mutations;

  const run = useCallback(
    async (goalId: string, accountId: string, targetPct: number): Promise<GoalSolveOutput | null> => {
      const key = `${goalId}:${accountId}`;
      setPendingKey(key);
      try {
        const res = await fetch(`/api/clients/${clientId}/solver/goal-solve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source, mutations: mutationsRef.current, goalId, accountId, targetPct, currentYear,
          }),
        });
        if (!res.ok) return null;
        return (await res.json()) as GoalSolveOutput;
      } catch {
        return null;
      } finally {
        setPendingKey(null);
      }
    },
    [clientId, source, currentYear],
  );

  return { pendingKey, run };
}
