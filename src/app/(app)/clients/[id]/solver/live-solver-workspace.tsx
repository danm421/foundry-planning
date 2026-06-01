"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientData, ProjectionYear, SavingsRule } from "@/engine";
import type { QuickAddType } from "@/lib/solver/quick-add-account";
import { buildAdditionalSavingsAccount } from "@/lib/solver/quick-add-account";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { mutationKey, type SolverMutation, type SolverMutationKey } from "@/lib/solver/types";
import type { SolveLeverKey, SolveProgressEvent, SolveResultEvent } from "@/lib/solver/solve-types";
import { buildLeverMutation } from "@/lib/solver/lever-search-config";
import { buildSolverComparisonPlan } from "@/lib/solver/build-solver-comparison-plan";
import { useSolverSolve } from "./use-solver-solve";
import { useSharedMcRun } from "@/app/(app)/clients/[id]/comparison/use-shared-mc-run";
import { liquidPortfolioTotal } from "@/components/charts/portfolio-bars-chart";
import { SolverChartPanel } from "./solver-chart-panel";
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
import { SolverYearsFundedKpi } from "./solver-years-funded-kpi";
import { SolverLifetimeTaxKpi } from "./solver-lifetime-tax-kpi";
import { yearsFullyFunded, lifetimeTaxes } from "@/lib/solver/solver-summary-metrics";
import { SaveAsScenarioDialog } from "./save-as-scenario-dialog";
import { SolverTechniquesTab } from "./solver-techniques-tab";
import { SolverTabLifeInsurance } from "./solver-tab-life-insurance";
import { SolverQuickAddAccount } from "./solver-quick-add-account";
import type { LiAssumptions } from "@/lib/life-insurance/schema";

// Matches the 85% default the per-lever Solve popovers offer (defaultTargetPct=85,
// which the popover submits as value/100).
const MIN_SAVINGS_TARGET_POS = 0.85;

function growthForType(type: QuickAddType, d: { taxable: number; retirement: number; cash: number }): number {
  if (type === "cash") return d.cash;
  if (type === "ira" || type === "roth_ira") return d.retirement;
  return d.taxable;
}

interface Props {
  clientId: string;
  baseClientData: ClientData;
  baseProjection: ProjectionYear[];
  initialSource: "base" | string;
  initialSourceClientData: ClientData;
  initialSourceProjection: ProjectionYear[];
  availableScenarios: { id: string; name: string }[];
  modelPortfolios: { id: string; name: string }[];
  milestones: import("@/lib/milestones").ClientMilestones;
  lifeInsuranceSettings: LiAssumptions;
  clientName: string;
  spouseName: string;
  categoryGrowthDefaults: { taxable: number; retirement: number; cash: number };
}

export function LiveSolverWorkspace({
  clientId,
  baseClientData,
  baseProjection,
  initialSource,
  initialSourceClientData,
  initialSourceProjection,
  availableScenarios,
  modelPortfolios,
  milestones,
  lifeInsuranceSettings,
  clientName,
  spouseName,
  categoryGrowthDefaults,
}: Props) {
  const router = useRouter();
  const currentYear = new Date().getFullYear();

  const ownerOptions = useMemo(() => {
    const fms = baseClientData.familyMembers ?? [];
    const clientFm = fms.find((fm) => fm.role === "client");
    const spouseFm = fms.find((fm) => fm.role === "spouse");
    const opts: { familyMemberId: string; label: string }[] = [];
    if (clientFm) opts.push({ familyMemberId: clientFm.id, label: clientName });
    if (spouseFm) opts.push({ familyMemberId: spouseFm.id, label: spouseName });
    return opts;
  }, [baseClientData, clientName, spouseName]);

  const retirementYearForOwner = useCallback((fmId: string): number => {
    const fms = baseClientData.familyMembers ?? [];
    const spouseFm = fms.find((fm) => fm.role === "spouse");
    const isSpouse = spouseFm?.id === fmId;
    const c = baseClientData.client;
    const dob = isSpouse ? c.spouseDob : c.dateOfBirth;
    const retAge = isSpouse ? (c.spouseRetirementAge ?? 65) : (c.retirementAge ?? 65);
    const birthYear = dob ? Number(String(dob).slice(0, 4)) : null;
    const curAge = birthYear != null && Number.isFinite(birthYear) ? currentYear - birthYear : 0;
    return currentYear + Math.max(0, retAge - curAge);
  }, [baseClientData, currentYear]);

  const [mutationMap, setMutationMap] = useState<Map<SolverMutationKey, SolverMutation>>(
    () => new Map(),
  );
  const mutations = useMemo(() => Array.from(mutationMap.values()), [mutationMap]);

  const [activeTab, setActiveTab] = useState<
    "retirement" | "techniques" | "life_insurance"
  >("retirement");

  // LI assumptions live here so a sibling chart panel can read them while the
  // Life Insurance tab is mounted; SolverTabLifeInsurance is a controlled view.
  const [liAssumptions, setLiAssumptions] =
    useState<LiAssumptions>(lifeInsuranceSettings);

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

  // Draft of the "minimum additional savings" goal-seek in flight. Kept in a
  // ref-mirrored state so onResult can rebuild the write-back upsert (full rule
  // + solved annualAmount) without re-deriving it. Cleared once written back so
  // a later unrelated solve-result can't re-fire it.
  const [minSavings, setMinSavings] = useState<{
    accountId: string;
    ruleId: string;
    rule: SavingsRule;
  } | null>(null);
  const minSavingsRef = useRef<typeof minSavings>(null);
  minSavingsRef.current = minSavings;

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
      // Min-savings write-back: if this solve targeted the synthetic
      // "Additional Savings" account, persist the solved value as a full
      // savings-rule-upsert (carrying fundFromExpenseReduction) rather than the
      // generic savings-contribution edit, so a saved scenario keeps the flag.
      const ms = minSavingsRef.current;
      const isMinSavings =
        ms != null &&
        prev.target.kind === "savings-contribution" &&
        prev.target.accountId === ms.accountId;
      const mutation: SolverMutation = isMinSavings
        ? {
            kind: "savings-rule-upsert",
            id: ms!.ruleId,
            value: { ...ms!.rule, annualAmount: e.solvedValue },
          }
        : // Apply the solved value against the live working tree so lever
          // mutations that depend on tree state (e.g. roth-conversion-amount,
          // which needs the technique's other fields) resolve correctly.
          buildLeverMutation(prev.target, e.solvedValue, workingTree);
      setMutationMap((mm) => {
        const next = new Map(mm);
        next.set(mutationKey(mutation), mutation);
        return next;
      });
      if (isMinSavings) setMinSavings(null);
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

  // Liquid portfolio (taxable + cash + retirement + life insurance), matching
  // the bar chart and cash-flow report. `portfolioAssets.total` also rolls in
  // real estate and business assets, which the KPI must not show.
  const baseEndingAssets =
    baseProjection.length > 0
      ? liquidPortfolioTotal(baseProjection[baseProjection.length - 1])
      : null;
  const workingEndingAssets =
    currentProjection.length > 0
      ? liquidPortfolioTotal(currentProjection[currentProjection.length - 1])
      : null;
  const endingAssetsDelta =
    baseEndingAssets != null && workingEndingAssets != null
      ? workingEndingAssets - baseEndingAssets
      : null;

  const baseYearsFunded = yearsFullyFunded(baseProjection);
  const workingYearsFunded = yearsFullyFunded(currentProjection);
  const baseLifetimeTax = lifetimeTaxes(baseProjection);
  const workingLifetimeTax = lifetimeTaxes(currentProjection);

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

  const [savingToBase, setSavingToBase] = useState(false);
  const [saveToBaseError, setSaveToBaseError] = useState<string | null>(null);

  async function handleSaveToBase() {
    if (
      !confirm(
        "Save these changes to base facts? This will update the client's real data and cannot be undone.",
      )
    )
      return;
    setSavingToBase(true);
    setSaveToBaseError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/solver/save-to-base`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: initialSource, mutations }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setMutationMap(new Map());
      setComputeStatus("fresh");
      router.refresh();
    } catch (err) {
      setSaveToBaseError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingToBase(false);
    }
  }

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
      // Re-fetch server components so the new scenario appears in the
      // ScenarioChipRow (rendered by the shared [id] layout, which a plain
      // push does not re-run). Mirrors create-scenario-dialog.tsx.
      router.refresh();
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
    (target: SolveLeverKey, targetPoS: number, extraMutations: SolverMutation[] = []) => {
      if (activeSolve) return;
      setSolveError(null);
      setActiveSolve({
        target,
        targetPoS,
        iteration: 0,
        candidateValue: null,
        achievedPoS: null,
      });
      // Merge any caller-supplied baseline mutations (e.g. the min-savings
      // account + rule just created) ahead of the committed map. State updates
      // from pushMutation haven't flushed yet when this runs synchronously, so
      // the search would otherwise not see them. last-write-per-key wins.
      const merged = new Map<SolverMutationKey, SolverMutation>();
      for (const m of mutations) merged.set(mutationKey(m), m);
      for (const m of extraMutations) merged.set(mutationKey(m), m);
      // Filter out any existing mutation for this lever; bisect iterates on it.
      // mutationKey() ignores the value, so we pass an arbitrary placeholder (0)
      // just to derive the key.
      const targetKey = mutationKey(buildLeverMutation(target, 0, initialSourceClientData));
      merged.delete(targetKey);
      void solveController.start({
        source: initialSource,
        mutations: Array.from(merged.values()),
        target,
        targetPoS,
      });
    },
    [activeSolve, mutations, initialSource, solveController, initialSourceClientData],
  );

  const handleSolveCancel = useCallback(() => {
    solveController.cancel();
    setActiveSolve(null);
  }, [solveController]);

  // "Solve minimum additional savings": stand up a real, savable taxable
  // account + a fundFromExpenseReduction rule at $0, push both into the
  // baseline (so the search sees them), then goal-seek the rule's contribution
  // toward the target PoS. onResult writes back the solved annualAmount.
  const handleSolveMinSavings = useCallback(
    (targetPoS: number) => {
      if (activeSolve) return;
      const owner = ownerOptions[0];
      if (!owner) return; // no owner → nothing to solve against
      const accountId = crypto.randomUUID();
      const ruleId = crypto.randomUUID();
      const { account, rule } = buildAdditionalSavingsAccount({
        ownerFamilyMemberId: owner.familyMemberId,
        startYear: currentYear,
        endYear: retirementYearForOwner(owner.familyMemberId),
        growthRate: categoryGrowthDefaults.taxable,
        accountId,
        ruleId,
      });
      const accountMutation: SolverMutation = {
        kind: "account-upsert",
        id: accountId,
        value: account,
      };
      const ruleMutation: SolverMutation = {
        kind: "savings-rule-upsert",
        id: ruleId,
        value: rule,
      };
      pushMutation(accountMutation);
      pushMutation(ruleMutation);
      setMinSavings({ accountId, ruleId, rule });
      // Pass the account+rule as extra baseline mutations: pushMutation's state
      // updates haven't flushed yet, so the solve must be told about them
      // directly or the search range would resolve against a tree with no rule.
      handleSolveStart({ kind: "savings-contribution", accountId }, targetPoS, [
        accountMutation,
        ruleMutation,
      ]);
    },
    // pushMutation is a plain component-scope function; its identity is
    // irrelevant here, so it's intentionally not a dependency.
    [
      activeSolve,
      ownerOptions,
      currentYear,
      retirementYearForOwner,
      categoryGrowthDefaults,
      handleSolveStart,
    ],
  );

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
      <SolverChartPanel
        currentProjection={currentProjection}
        baseProjection={baseProjection}
        workingTree={workingTree}
        computeStatus={computeStatus}
        clientId={clientId}
        liAssumptions={liAssumptions}
        clientName={clientName}
        spouseName={spouseName}
        showLifeInsuranceTab={activeTab === "life_insurance"}
      />

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
                <SolverYearsFundedKpi value={baseYearsFunded} />
                <SolverLifetimeTaxKpi value={baseLifetimeTax} />
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
                <SolverYearsFundedKpi
                  value={workingYearsFunded}
                  delta={workingYearsFunded - baseYearsFunded}
                  dimmed={computeStatus === "computing"}
                />
                <SolverLifetimeTaxKpi
                  value={workingLifetimeTax}
                  delta={workingLifetimeTax - baseLifetimeTax}
                  dimmed={computeStatus === "computing"}
                />
              </div>
            </div>
          </div>
        }
      >
        <div
          role="tablist"
          aria-label="Solver editing surface"
          className="flex gap-1 border-b border-hair-2 px-3 pt-2"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "retirement"}
            onClick={() => setActiveTab("retirement")}
            className={
              activeTab === "retirement"
                ? "border-b-2 border-accent px-3 py-1.5 text-[13px] font-medium text-ink"
                : "border-b-2 border-transparent px-3 py-1.5 text-[13px] text-ink-3 hover:text-ink"
            }
          >
            Retirement
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "techniques"}
            onClick={() => setActiveTab("techniques")}
            className={
              activeTab === "techniques"
                ? "border-b-2 border-accent px-3 py-1.5 text-[13px] font-medium text-ink"
                : "border-b-2 border-transparent px-3 py-1.5 text-[13px] text-ink-3 hover:text-ink"
            }
          >
            Techniques
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "life_insurance"}
            onClick={() => setActiveTab("life_insurance")}
            className={
              activeTab === "life_insurance"
                ? "border-b-2 border-accent px-3 py-1.5 text-[13px] font-medium text-ink"
                : "border-b-2 border-transparent px-3 py-1.5 text-[13px] text-ink-3 hover:text-ink"
            }
          >
            Life Insurance
          </button>
        </div>

        {activeTab === "retirement" && (
          <>
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
              <SolverQuickAddAccount
                owners={ownerOptions}
                currentYear={currentYear}
                retirementYearForOwner={retirementYearForOwner}
                growthForType={(t) => growthForType(t, categoryGrowthDefaults)}
                onChange={pushMutation}
              />
              <div>
                <button
                  type="button"
                  onClick={() => handleSolveMinSavings(MIN_SAVINGS_TARGET_POS)}
                  disabled={activeSolve !== null || ownerOptions.length === 0}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-on disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Solve minimum additional savings
                </button>
              </div>
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
          </>
        )}

        {activeTab === "techniques" && (
          <SolverTechniquesTab
            clientId={clientId}
            baseClientData={baseClientData}
            workingTree={workingTree}
            accounts={(baseClientData.accounts ?? []).map((a) => ({
              id: a.id,
              name: a.name,
              category: a.category,
              subType: a.subType ?? "",
            }))}
            liabilities={(baseClientData.liabilities ?? []).map((l) => ({
              id: l.id,
              name: l.name,
              linkedPropertyId: l.linkedPropertyId ?? null,
              balance: String(l.balance ?? 0),
            }))}
            modelPortfolios={modelPortfolios}
            milestones={milestones}
            onChange={pushMutation}
            onSolveStart={handleSolveStart}
          />
        )}

        {activeTab === "life_insurance" && (
          <SolverTabLifeInsurance
            clientId={clientId}
            assumptions={liAssumptions}
            onAssumptionsChange={setLiAssumptions}
            clientName={clientName}
            spouseName={spouseName}
            liabilities={(baseClientData.liabilities ?? []).map((l) => ({
              id: l.id,
              name: l.name,
              balance: l.balance,
            }))}
            estateAdminExpenses={baseClientData.planSettings.estateAdminExpenses ?? 0}
            modelPortfolios={modelPortfolios}
          />
        )}
      </SolverCompareGrid>

      <SolverActionBar
        hasMutations={mutations.length > 0}
        canSaveToBase={mutations.some(
          (m) => m.kind === "account-upsert" || m.kind === "savings-rule-upsert",
        )}
        mcRunning={mcRunning}
        solveActive={activeSolve !== null}
        savingToBase={savingToBase}
        onReset={handleReset}
        onGenerateMc={handleGenerateMc}
        onSave={() => setSaveOpen(true)}
        onSaveToBase={handleSaveToBase}
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
      {saveToBaseError ? (
        <div role="alert" className="text-[13px] text-crit">
          Save to base facts failed: {saveToBaseError}
        </div>
      ) : null}
    </div>
  );
}
