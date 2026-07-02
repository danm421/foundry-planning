// src/app/(app)/clients/[id]/solver/use-education-solve.ts
"use client";

import { useCallback, useRef, useState } from "react";
import type { SolverMutation } from "@/lib/solver/types";

export interface EducationSolveOutput {
  additionalAnnual: number;
  fundsFully: boolean;
}

export function useEducationSolve(args: {
  clientId: string;
  source: string;
  mutations: SolverMutation[];
}) {
  const { clientId, source, mutations } = args;
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  // Read the latest mutations at call time without re-creating `run`.
  const mutationsRef = useRef(mutations);
  mutationsRef.current = mutations;

  const run = useCallback(
    async (goalId: string, accountId: string): Promise<EducationSolveOutput | null> => {
      const key = `${goalId}:${accountId}`;
      setPendingKey(key);
      try {
        const res = await fetch(`/api/clients/${clientId}/solver/education-solve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source, mutations: mutationsRef.current, goalId, accountId }),
        });
        if (!res.ok) return null;
        return (await res.json()) as EducationSolveOutput;
      } catch {
        return null;
      } finally {
        setPendingKey(null);
      }
    },
    [clientId, source],
  );

  return { pendingKey, run };
}
