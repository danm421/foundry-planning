"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientData, ProjectionYear } from "@/engine";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { mutationKey, type SolverMutation, type SolverMutationKey } from "@/lib/solver/types";
import { buildSolverComparisonPlan } from "@/lib/solver/build-solver-comparison-plan";
import { useSharedMcRun } from "@/app/(app)/clients/[id]/comparison/use-shared-mc-run";
import { PortfolioBarsChart } from "@/components/charts/portfolio-bars-chart";
import { SolverCompareGrid } from "./solver-compare-grid";
import { SolverSection } from "./solver-section";
import { SolverRowRetirementAges } from "./solver-row-retirement-ages";
import { SolverRowLifeExpectancy } from "./solver-row-life-expectancy";
import { SolverRowSocialSecurity } from "./solver-row-social-security";
import { SolverRowSavingsContributions } from "./solver-row-savings-contributions";
import { SolverRowLivingExpenseScale } from "./solver-row-living-expense-scale";
import { SolverActionBar } from "./solver-action-bar";
import { SolverPosGauge } from "./solver-pos-gauge";
import { SaveAsScenarioDialog } from "./save-as-scenario-dialog";

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
  availableScenarios,
}: Props) {
  const router = useRouter();
  const currentYear = new Date().getFullYear();
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

  const [mcRequested, setMcRequested] = useState(false);
  const [mcVersion, setMcVersion] = useState(0);

  const workingTree = useMemo(
    () => applyMutations(initialSourceClientData, mutations),
    [initialSourceClientData, mutations],
  );

  const mcPlans = useMemo(
    () => [
      buildSolverComparisonPlan({
        id: `base:v${mcVersion}`,
        label: "Base Facts",
        tree: baseClientData,
        years: baseProjection,
        isBaseline: true,
        index: 0,
      }),
      buildSolverComparisonPlan({
        id: `working:v${mcVersion}`,
        label: "Working",
        tree: workingTree,
        years: currentProjection,
        isBaseline: false,
        index: 1,
      }),
    ],
    [baseClientData, baseProjection, workingTree, currentProjection, mcVersion],
  );

  const mcController = useSharedMcRun({
    clientId,
    plans: mcPlans,
    enabled: mcRequested,
  });

  const lastSuccessfulMcVersion = useRef<number | null>(null);
  useEffect(() => {
    if (mcController.status === "ready") {
      lastSuccessfulMcVersion.current = mcVersion;
    }
  }, [mcController.status, mcVersion]);

  const mcRunning = mcController.status === "loading";
  const mcReady = mcController.status === "ready";
  const workingChangedSinceMc =
    mcReady && lastSuccessfulMcVersion.current !== mcVersion;

  const baseState: "idle" | "computing" | "ready" =
    mcReady ? "ready" : mcRunning ? "computing" : "idle";

  const workingState: "idle" | "computing" | "ready" | "stale" = mcReady
    ? workingChangedSinceMc
      ? "stale"
      : "ready"
    : mcRunning
      ? "computing"
      : "idle";

  const baseSuccess =
    mcReady
      ? (mcController.result?.perPlan.find((p) => p.planId.startsWith("base:"))
          ?.successRate ?? null)
      : null;
  const workingSuccess =
    mcReady
      ? (mcController.result?.perPlan.find((p) =>
          p.planId.startsWith("working:"),
        )?.successRate ?? null)
      : null;

  const handleGenerateMc = useCallback(() => {
    setMcRequested(true);
    setMcVersion((v) => v + 1);
  }, []);

  const handleReset = useCallback(() => {
    setMutationMap(new Map());
    setComputeStatus("fresh");
    setCurrentProjection(initialSourceProjection);
  }, [initialSourceProjection]);

  function handleSourceChange(next: string) {
    if (mutations.length > 0) {
      if (!confirm("Discard your pending edits and load this scenario?")) return;
    }
    const target =
      next === "base"
        ? `/clients/${clientId}/solver`
        : `/clients/${clientId}/solver?scenario=${next}`;
    router.push(target);
  }

  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSaveSubmit(args: { name: string }) {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/solver/save-scenario`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: initialSource,
          mutations,
          name: args.name,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { scenarioId: string };
      setSaveOpen(false);
      router.push(`/clients/${clientId}/comparison?scenario=${data.scenarioId}`);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

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

      {computeStatus === "computing" ? (
        <div className="text-xs text-gray-400 -mt-2">Recalculating…</div>
      ) : null}

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
            <SolverPosGauge state={baseState} successPct={baseSuccess} />
          </div>
        }
        rightHeader={
          <div>
            <div className="flex items-center gap-2">
              <select
                aria-label="Right-column source"
                value={initialSource}
                onChange={(e) => handleSourceChange(e.target.value)}
                className="border border-gray-300 rounded text-sm px-2 py-1"
              >
                <option value="base">Base Facts</option>
                {availableScenarios.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <SolverPosGauge state={workingState} successPct={workingSuccess} />
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

        <SolverSection title="Income & Savings">
          <SolverRowSavingsContributions
            baseClientData={baseClientData}
            workingClientData={workingTree}
            currentYear={currentYear}
            onChange={pushMutation}
          />
        </SolverSection>

        <SolverSection title="Expenses">
          <SolverRowLivingExpenseScale
            baseExpenses={baseClientData.expenses}
            onChange={pushMutation}
          />
        </SolverSection>
      </SolverCompareGrid>

      <SolverActionBar
        hasMutations={mutations.length > 0}
        mcRunning={mcRunning}
        onReset={handleReset}
        onGenerateMc={handleGenerateMc}
        onSave={() => setSaveOpen(true)}
      />

      <SaveAsScenarioDialog
        open={saveOpen}
        mutations={mutations}
        onClose={() => (saving ? null : setSaveOpen(false))}
        onSubmit={handleSaveSubmit}
      />
      {saveError ? (
        <div className="text-sm text-red-600">Save failed: {saveError}</div>
      ) : null}
    </div>
  );
}
