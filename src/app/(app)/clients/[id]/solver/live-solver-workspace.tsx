"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientData, ProjectionYear } from "@/engine";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { mutationKey, type SolverMutation, type SolverMutationKey } from "@/lib/solver/types";
import type { SolveLeverKey, SolveProgressEvent, SolveResultEvent } from "@/lib/solver/solve-types";
import { buildLeverMutation } from "@/lib/solver/lever-search-config";
import { buildSolverComparisonPlan } from "@/lib/solver/build-solver-comparison-plan";
import { useSolverSolve } from "./use-solver-solve";
import { useSharedMcRun } from "@/app/(app)/clients/[id]/comparison/use-shared-mc-run";
import { PortfolioBarsChart } from "@/components/charts/portfolio-bars-chart";
import { SolverCompareGrid } from "./solver-compare-grid";
import { SolverSection } from "./solver-section";
import { SolverRowRetirementAges } from "./solver-row-retirement-ages";
import { SolverRowLifeExpectancy } from "./solver-row-life-expectancy";
import { SolverRowSocialSecurity } from "./solver-row-social-security";
import { SolverRowSavingsContributions } from "./solver-row-savings-contributions";
import { SolverRowIncomes } from "./solver-row-incomes";
import { SolverRowLivingExpenseScale } from "./solver-row-living-expense-scale";
import { SolverActionBar } from "./solver-action-bar";
import { SolverPosGauge } from "./solver-pos-gauge";
import { SolverEndingAssetsKpi } from "./solver-ending-assets-kpi";
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

  type ActiveSolve = {
    target: SolveLeverKey;
    targetPoS: number;
    iteration: number;
    candidateValue: number | null;
    achievedPoS: number | null;
  };

  const [activeSolve, setActiveSolve] = useState<ActiveSolve | null>(null);
  const [solveError, setSolveError] = useState<string | null>(null);
  const activeSolveRef = useRef<ActiveSolve | null>(null);
  activeSolveRef.current = activeSolve;

  const solveController = useSolverSolve({
    clientId,
    onProgress: (e: SolveProgressEvent) => {
      setActiveSolve((prev) =>
        prev
          ? { ...prev, iteration: e.iteration, candidateValue: e.candidateValue, achievedPoS: e.achievedPoS }
          : prev,
      );
    },
    onResult: (e: SolveResultEvent) => {
      // Read activeSolve via the latest ref so we don't side-effect inside the
      // setActiveSolve updater (React requires updater purity; double-invocation
      // under StrictMode would otherwise call setMutationMap twice).
      const prev = activeSolveRef.current;
      if (!prev) return;
      const mutation = buildLeverMutation(prev.target, e.solvedValue);
      setMutationMap((mm) => {
        const next = new Map(mm);
        next.set(mutationKey(mutation), mutation);
        return next;
      });
      setCurrentProjection(e.finalProjection);
      setComputeStatus("fresh");
      setActiveSolve(null);
    },
    onError: (msg) => {
      setActiveSolve(null);
      setSolveError(msg);
    },
  });

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

  const baseEndingAssets =
    baseProjection.length > 0
      ? baseProjection[baseProjection.length - 1].portfolioAssets.total
      : null;
  const workingEndingAssets =
    currentProjection.length > 0
      ? currentProjection[currentProjection.length - 1].portfolioAssets.total
      : null;
  const endingAssetsDelta =
    baseEndingAssets != null && workingEndingAssets != null
      ? workingEndingAssets - baseEndingAssets
      : null;

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

  const handleSolveStart = useCallback(
    (target: SolveLeverKey, targetPoS: number) => {
      if (activeSolve) return;
      setSolveError(null);
      setActiveSolve({
        target,
        targetPoS,
        iteration: 0,
        candidateValue: null,
        achievedPoS: null,
      });
      // Filter out any existing mutation for this lever; bisect iterates on it.
      // mutationKey() ignores the value, so we pass an arbitrary placeholder (0)
      // just to derive the key.
      const targetKey = mutationKey(buildLeverMutation(target, 0));
      const baselineMutations = mutations.filter((m) => mutationKey(m) !== targetKey);
      void solveController.start({
        source: initialSource,
        mutations: baselineMutations,
        target,
        targetPoS,
      });
    },
    [activeSolve, mutations, initialSource, solveController],
  );

  const handleSolveCancel = useCallback(() => {
    solveController.cancel();
    setActiveSolve(null);
  }, [solveController]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (activeSolve) return; // solve owns the projection while running
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
    }, 600);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [mutations, clientId, initialSource, initialSourceProjection, activeSolve]);

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-hair bg-card p-4">
        <div style={{ height: 300 }}>
          <PortfolioBarsChart current={currentProjection} baseline={baseProjection} />
        </div>
        {computeStatus === "computing" ? (
          <div
            aria-live="polite"
            className="mt-2 inline-flex items-center gap-2 text-[11px] text-ink-3"
          >
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full bg-accent/70 animate-pulse"
            />
            Recalculating…
          </div>
        ) : null}
      </div>

      {errorMessage ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-crit/40 bg-crit/10 px-3 py-2 text-[13px] text-crit"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="mt-0.5 h-4 w-4 shrink-0"
            fill="currentColor"
          >
            <path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm.75 9.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm-.75-7a.75.75 0 0 1 .75.75v4a.75.75 0 0 1-1.5 0v-4a.75.75 0 0 1 .75-.75Z" />
          </svg>
          <span>
            <span className="font-medium">Recompute failed.</span>{" "}
            <span className="text-crit/80">{errorMessage}</span>
          </span>
        </div>
      ) : null}

      {solveError ? (
        <div role="alert" className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[13px] text-warn">
          Solve failed: {solveError}
        </div>
      ) : null}

      <SolverCompareGrid
        leftHeader={
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">
                Base Facts
              </div>
              <div className="mt-3 flex items-start gap-6">
                <SolverPosGauge state={baseState} successPct={baseSuccess} />
                <SolverEndingAssetsKpi value={baseEndingAssets} />
              </div>
            </div>
          </div>
        }
        rightHeader={
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-ink-3">
                Scenario
              </div>
              <div className="mt-1.5">
                <div className="relative inline-flex">
                  <select
                    aria-label="Right-column source"
                    value={initialSource}
                    onChange={(e) => handleSourceChange(e.target.value)}
                    className="appearance-none h-8 rounded-md border border-hair-2 bg-card-2 pl-2.5 pr-7 text-[13px] text-ink hover:border-accent/60 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                  >
                    <option value="base">Base Facts</option>
                    {availableScenarios.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 12 12"
                    className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-ink-3"
                  >
                    <path
                      d="M3 4.5 6 7.5l3-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
              </div>
              <div className="mt-2.5 flex items-start gap-6">
                <SolverPosGauge state={workingState} successPct={workingSuccess} />
                <SolverEndingAssetsKpi
                  value={workingEndingAssets}
                  delta={endingAssetsDelta}
                  dimmed={computeStatus === "computing"}
                />
              </div>
            </div>
          </div>
        }
      >
        <SolverSection title="Goals">
          <SolverRowRetirementAges
            baseClient={baseClientData.client}
            workingClient={workingTree.client}
            onChange={pushMutation}
            activeSolve={activeSolve}
            onSolveStart={handleSolveStart}
            onSolveCancel={handleSolveCancel}
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
            activeSolve={activeSolve}
            onSolveStart={handleSolveStart}
            onSolveCancel={handleSolveCancel}
          />
        </SolverSection>

        <SolverSection title="Income & Savings">
          <SolverRowIncomes
            baseClientData={baseClientData}
            workingClientData={workingTree}
            currentYear={currentYear}
            onChange={pushMutation}
          />
          <SolverRowSavingsContributions
            baseClientData={baseClientData}
            workingClientData={workingTree}
            currentYear={currentYear}
            onChange={pushMutation}
            activeSolve={activeSolve}
            onSolveStart={handleSolveStart}
            onSolveCancel={handleSolveCancel}
          />
        </SolverSection>

        <SolverSection title="Expenses">
          <SolverRowLivingExpenseScale
            baseExpenses={baseClientData.expenses}
            workingExpenses={workingTree.expenses}
            currentYear={currentYear}
            onChange={pushMutation}
            activeSolve={activeSolve}
            onSolveStart={handleSolveStart}
            onSolveCancel={handleSolveCancel}
          />
        </SolverSection>
      </SolverCompareGrid>

      <SolverActionBar
        hasMutations={mutations.length > 0}
        mcRunning={mcRunning}
        solveActive={activeSolve !== null}
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
        <div role="alert" className="text-[13px] text-crit">
          Save failed: {saveError}
        </div>
      ) : null}
    </div>
  );
}
