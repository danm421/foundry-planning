"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientData, ProjectionYear } from "@/engine";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { mutationKey, type SolverMutation, type SolverMutationKey } from "@/lib/solver/types";
import { PortfolioBarsChart } from "@/components/charts/portfolio-bars-chart";
import { SolverCompareGrid } from "./solver-compare-grid";
import { SolverSection } from "./solver-section";
import { SolverRowRetirementAges } from "./solver-row-retirement-ages";
import { SolverRowLifeExpectancy } from "./solver-row-life-expectancy";
import { SolverRowSocialSecurity } from "./solver-row-social-security";

interface Props {
  clientId: string;
  baseClientData: ClientData;
  baseProjection: ProjectionYear[];
  initialSource: "base" | string;
  initialSourceClientData: ClientData;
  initialSourceProjection: ProjectionYear[];
  availableScenarios: { id: string; name: string }[];
}

export function LiveSolverWorkspace({
  clientId,
  baseClientData,
  baseProjection,
  initialSource,
  initialSourceClientData,
  initialSourceProjection,
}: Props) {
  const [mutationMap, setMutationMap] = useState<Map<SolverMutationKey, SolverMutation>>(
    () => new Map(),
  );
  const mutations = useMemo(() => Array.from(mutationMap.values()), [mutationMap]);

  const [currentProjection, setCurrentProjection] = useState<ProjectionYear[]>(
    initialSourceProjection,
  );
  const [computeStatus, setComputeStatus] = useState<
    "fresh" | "stale" | "computing" | "error"
  >("fresh");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const workingTree = useMemo(
    () => applyMutations(initialSourceClientData, mutations),
    [initialSourceClientData, mutations],
  );

  function pushMutation(m: SolverMutation) {
    setMutationMap((prev) => {
      const next = new Map(prev);
      next.set(mutationKey(m), m);
      return next;
    });
    setComputeStatus("stale");
  }

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (mutations.length === 0) {
      setCurrentProjection(initialSourceProjection);
      setComputeStatus("fresh");
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setComputeStatus("computing");
      try {
        const res = await fetch(`/api/clients/${clientId}/solver/project`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: initialSource, mutations }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: { projection: ProjectionYear[] } = await res.json();
        setCurrentProjection(data.projection);
        setComputeStatus("fresh");
        setErrorMessage(null);
      } catch (err) {
        setComputeStatus("error");
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [mutations, clientId, initialSource, initialSourceProjection]);

  return (
    <div className="p-4 space-y-4">
      <PortfolioBarsChart current={currentProjection} baseline={baseProjection} />

      {errorMessage ? (
        <div className="border border-red-300 bg-red-50 text-red-700 text-sm rounded px-3 py-2">
          Recompute failed: {errorMessage}
        </div>
      ) : null}

      <SolverCompareGrid
        leftHeader={
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">
              Base Facts
            </div>
            <div className="text-sm text-gray-400 mt-1">
              Probability of Success: —
            </div>
          </div>
        }
        rightHeader={
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">
              Working state
            </div>
            <div className="text-sm text-gray-400 mt-1">
              Probability of Success:{" "}
              {computeStatus === "computing" ? "…" : "—"}
            </div>
          </div>
        }
      >
        <SolverSection title="Goals">
          <SolverRowRetirementAges
            baseClient={baseClientData.client}
            workingClient={workingTree.client}
            onChange={pushMutation}
          />
          <SolverRowLifeExpectancy
            baseClient={baseClientData.client}
            workingClient={workingTree.client}
            onChange={pushMutation}
          />
          <SolverRowSocialSecurity
            baseIncomes={baseClientData.incomes}
            workingIncomes={workingTree.incomes}
            baseClient={baseClientData.client}
            workingClient={workingTree.client}
            onChange={pushMutation}
          />
        </SolverSection>
      </SolverCompareGrid>
    </div>
  );
}
