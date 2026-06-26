"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useClientAccess } from "@/components/client-access-provider";
import type { ClientData, ProjectionYear, SavingsRule } from "@/engine";
import { controllingFamilyMember } from "@/engine/ownership";
import type { QuickAddType } from "@/lib/solver/quick-add-account";
import { buildAdditionalSavingsAccount } from "@/lib/solver/quick-add-account";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { mutationKey, type SolverMutation, type SolverMutationKey } from "@/lib/solver/types";
import { isBaseSavableMutation } from "@/lib/solver/mutations-to-base-updates";
import type { SolveLeverKey, SolveProgressEvent, SolveResultEvent } from "@/lib/solver/solve-types";
import { buildLeverMutation } from "@/lib/solver/lever-search-config";
import { useSolverSolve } from "./use-solver-solve";
import { useSolverMc } from "./use-solver-mc";
import { deriveScenarioGaugeState } from "./scenario-gauge-state";
import { liquidPortfolioTotal } from "@/components/charts/portfolio-bars-chart";
import { SolverChartPanel } from "./solver-chart-panel";
import { SolverKpiStrip } from "./solver-kpi-strip";
import { defaultReportForTab, type InputTab, type ReportKey } from "./report-tab-link";
import { SolverSection } from "./solver-section";
import { SolverRowRetirementAges } from "./solver-row-retirement-ages";
import { SolverRowLifeExpectancy } from "./solver-row-life-expectancy";
import { SolverRowSocialSecurity } from "./solver-row-social-security";
import { SolverRowSavingsContributions } from "./solver-row-savings-contributions";
import { SolverRowIncomes } from "./solver-row-incomes";
import { SolverRowLivingExpenseScale } from "./solver-row-living-expense-scale";
import { SolverActionBar } from "./solver-action-bar";
import { yearsFullyFunded, lifetimeTaxes } from "@/lib/solver/solver-summary-metrics";
import { SaveAsScenarioDialog } from "./save-as-scenario-dialog";
import { SolverTechniquesTab } from "./solver-techniques-tab";
import {
  SolverLifeInsuranceInputs,
  SolverLifeInsuranceResults,
  useLiNeedSolve,
} from "./solver-tab-life-insurance";
import { SolverTabEstatePlanning } from "./solver-tab-estate-planning";
import { SolverQuickAddAccount } from "./solver-quick-add-account";
import type { LiAssumptions } from "@/lib/life-insurance/schema";
import type { SolverModelPortfolio } from "@/lib/solver/model-portfolio-config";
import { SolverMinSavingsPanel, type MinSavingsResult } from "./solver-min-savings-panel";
import { buildLockInCutMutations } from "@/lib/solver/lock-in-cut";

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
  modelPortfolios: SolverModelPortfolio[];
  milestones: import("@/lib/milestones").ClientMilestones;
  lifeInsuranceSettings: LiAssumptions;
  clientName: string;
  spouseName: string;
  categoryGrowthDefaults: { taxable: number; retirement: number; cash: number };
}

/** Left-pane input tabs, in display order. Mirrors SolverChartPanel's REPORT_TABS. */
const LEFT_TABS: { id: InputTab; label: string }[] = [
  { id: "retirement", label: "Retirement" },
  { id: "techniques", label: "Techniques" },
  { id: "life_insurance", label: "Life Insurance" },
  { id: "estate_planning", label: "Estate Planning" },
];

export function LiveSolverWorkspace({
  clientId,
  baseClientData,
  baseProjection,
  initialSource,
  initialSourceClientData,
  initialSourceProjection,
  modelPortfolios,
  milestones,
  lifeInsuranceSettings,
  clientName,
  spouseName,
  categoryGrowthDefaults,
}: Props) {
  const router = useRouter();
  const currentYear = new Date().getFullYear();
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";

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

  const [activeTab, setActiveTab] = useState<InputTab>("retirement");

  // The right-pane report is linked to the left input tab: selecting an input
  // tab applies that tab's default report; clicking a report tab overrides it
  // until the next input-tab change.
  const [activeReport, setActiveReport] = useState<ReportKey>(
    defaultReportForTab("retirement"),
  );
  const handleTabChange = useCallback((tab: InputTab) => {
    setActiveTab(tab);
    setActiveReport(defaultReportForTab(tab));
  }, []);

  // LI assumptions live here so both the left-pane inputs view and the right-
  // pane results/chart can read them; the LI views are controlled.
  const [liAssumptions, setLiAssumptions] =
    useState<LiAssumptions>(lifeInsuranceSettings);

  // The straight-line LI solve runs only while the LI surface is in view —
  // either its input tab (left) or its report (right). `enabled` gates the
  // hook so it never fires a /solve or /settings request on unrelated tabs
  // (notably the default retirement view).
  const liEnabled =
    activeTab === "life_insurance" || activeReport === "lifeInsurance";
  const liSolve = useLiNeedSolve(clientId, liAssumptions, liEnabled);

  const [currentProjection, setCurrentProjection] = useState<ProjectionYear[]>(
    initialSourceProjection,
  );
  const [computeStatus, setComputeStatus] = useState<
    "fresh" | "stale" | "computing" | "error"
  >("fresh");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [mcRequested, setMcRequested] = useState(false);
  const [mcVersion, setMcVersion] = useState(0);
  // First/auto run computes Base + Scenario; Recalculate re-runs the Scenario
  // only (Base facts can't change in the solver), so the next run's plan set
  // depends on this flag.
  const [includeBase, setIncludeBase] = useState(true);
  // Base success rate from the first run, retained for the whole session.
  const [cachedBaseSuccess, setCachedBaseSuccess] = useState<number | null>(null);
  // Monotonic count of edits since mount — drives Scenario PoS staleness.
  const [editNonce, setEditNonce] = useState(0);
  // The editNonce captured when the current/last working-MC run launched.
  const [mcEditNonce, setMcEditNonce] = useState<number | null>(null);

  // Canonical 1,000-trial PoS from the most recent converged solve, on the
  // converged tree. Shown on the working gauge until the useSolverMc run produces
  // a fresh result for the current edits (which then supersedes it). Cleared on
  // any further edit so it can't go stale.
  const [solvedPoS, setSolvedPoS] = useState<number | null>(null);
  // MC seed used for the canonical solve run — persisted when saving the
  // scenario so its report reproduces the same PoS.
  const [solvedSeed, setSolvedSeed] = useState<number | null>(null);

  type ActiveSolve = {
    target: SolveLeverKey;
    targetPoS?: number;
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
    portfolio: SolverModelPortfolio;
    targetPoS: number;
  } | null>(null);
  const minSavingsRef = useRef<typeof minSavings>(null);
  minSavingsRef.current = minSavings;

  // Min-savings result currently shown in the panel (null = idle/no result).
  const [minSavingsResult, setMinSavingsResult] = useState<MinSavingsResult | null>(null);
  // Synthetic-account asset mixes to inject into MC, keyed by account id.
  const [savingsAccountMixes, setSavingsAccountMixes] = useState<Map<string, { assetClassId: string; weight: number }[]>>(() => new Map());
  // fundFromExpenseReduction accounts surfaced as editable boxes ("Keep self-funding").
  const [visibleSelfFundingAccts, setVisibleSelfFundingAccts] = useState<Set<string>>(() => new Set());
  // The current still-UNCOMMITTED synthetic Additional Savings account from the
  // last min-savings solve. Set when a solve mints the account, cleared when the
  // advisor commits it (Keep self-funding / Lock in cut) or discards it (Dismiss).
  // Lets a re-solve retire the prior uncommitted account instead of stacking a
  // second one, and lets the include handlers target THIS account rather than a
  // fragile `.find(fundFromExpenseReduction)` that grabs the oldest committed one.
  const pendingSyntheticRef = useRef<{ accountId: string; ruleId: string } | null>(null);
  // Working-tree year-0 living captured at solve start, for the outcome delta.
  const baselineLivingRef = useRef<number>(0);

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
      if (e.objective === "ending-portfolio") {
        // Deterministic SS claim-age solve. Apply the winning age, forcing
        // `years` mode so it takes effect even if the row was in FRA /
        // at-retirement mode. Leave the PoS gauge stale — exactly like a manual
        // edit; the advisor re-runs MC on demand for a fresh PoS.
        if (prev.target.kind !== "ss-claim-age") return;
        const person = prev.target.person;
        const modeMutation: SolverMutation = {
          kind: "ss-claim-age-mode",
          person,
          mode: "years",
        };
        const ageMutation: SolverMutation = {
          kind: "ss-claim-age",
          person,
          age: e.solvedValue,
        };
        setMutationMap((mm) => {
          const next = new Map(mm);
          next.set(mutationKey(modeMutation), modeMutation);
          next.set(mutationKey(ageMutation), ageMutation);
          return next;
        });
        setCurrentProjection(e.finalProjection);
        setSolvedPoS(null);
        setSolvedSeed(null);
        setComputeStatus("stale");
        setEditNonce((n) => n + 1); // SS-solve changed the tree → Scenario stale
        setActiveSolve(null);
        return;
      }
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
      if (isMinSavings && ms) {
        // Build the panel's outcome summary from the converged year-0 row:
        // updated living + the savings waterfall split (cash flow vs. expense
        // reduction). e.status is safe here — the min-savings branch is always
        // objective: "pos".
        const y0 = e.finalProjection[0];
        const updatedLiving = y0?.expenses.living ?? 0;
        const hs = y0?.hypotheticalSavings;
        setMinSavingsResult({
          status: e.objective === "pos" ? e.status : "converged",
          savings: e.solvedValue,
          portfolioName: ms.portfolio.name,
          startYear: ms.rule.startYear,
          endYear: ms.rule.endYear,
          targetPoS: ms.targetPoS,
          baselineLiving: baselineLivingRef.current,
          updatedLiving,
          fromCashFlow: hs?.fromCashFlow ?? 0,
          fromExpenseReduction:
            hs?.fromExpenseReduction ?? Math.max(0, baselineLivingRef.current - updatedLiving),
        });
        setMinSavings(null);
      }
      setCurrentProjection(e.finalProjection);
      // Surface the canonical 1,000-trial PoS (computed on the converged tree)
      // as the advisor-facing solved result so it matches the MC report/PDF,
      // which also use 1,000 trials — not the noisier 250-trial search value.
      setSolvedPoS(e.canonicalPoS);
      // Capture the seed so save-as-scenario can persist it, letting the saved
      // scenario's report reproduce the same PoS byte-for-byte.
      setSolvedSeed(e.seed);
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

  // Asset mixes for synthetic savings accounts, threaded into MC so the
  // additional-savings dollars grow on the chosen portfolio's allocation rather
  // than the deterministic growthRate fallback. Drop entries whose account no
  // longer exists in the working tree (e.g. after a reset).
  const extraAccountMixes = useMemo(() => {
    const ids = new Set(workingTree.accounts.map((a) => a.id));
    return Array.from(savingsAccountMixes.entries())
      .filter(([accountId]) => ids.has(accountId))
      .map(([accountId, mix]) => ({ accountId, mix }));
  }, [workingTree.accounts, savingsAccountMixes]);

  const existingAddable = useMemo(() => {
    const withRule = new Set(workingTree.savingsRules.map((r) => r.accountId));
    return (baseClientData.accounts ?? [])
      .filter(
        (a) =>
          (a.category === "taxable" || a.category === "cash" || a.category === "retirement") &&
          !withRule.has(a.id),
      )
      .map((a) => ({
        id: a.id,
        name: a.name,
        category: a.category,
        subType: a.subType ?? "",
        ownerFamilyMemberId: controllingFamilyMember(a) ?? "",
      }));
  }, [baseClientData.accounts, workingTree.savingsRules]);

  const mc = useSolverMc({
    clientId,
    source: initialSource,
    mutations,
    includeBase,
    enabled: mcRequested,
    nonce: mcVersion,
    extraAccountMixes,
  });

  // Base facts can't change in the solver, so the Base PoS is computed once on
  // the first (Base-inclusive) run and retained — a working-only Recalculate
  // doesn't refetch Base, so we keep the cached value instead of overwriting.
  useEffect(() => {
    if (mc.status !== "ready") return;
    if (mc.baseSuccessRate !== null) setCachedBaseSuccess(mc.baseSuccessRate);
  }, [mc.status, mc.baseSuccessRate]);

  const baseSuccess = cachedBaseSuccess;

  const mcWorkingSuccess =
    mc.status === "ready" ? mc.workingSuccessRate : null;

  const scenarioGauge = deriveScenarioGaugeState({
    mcStatus: mc.status,
    mcWorkingSuccess,
    solvedPoS,
    editNonce,
    mcEditNonce,
  });

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

  // Launch an MC run. `withBase` true on the first/auto run (computes and
  // caches Base + Scenario); false on Recalculate (Scenario only). Clearing
  // solvedPoS lets the fresh MC result supersede a prior solve's canonical PoS.
  const launchMc = useCallback(
    (withBase: boolean) => {
      setMcRequested(true);
      setIncludeBase(withBase);
      setMcEditNonce(editNonce);
      setSolvedPoS(null);
      setMcVersion((v) => v + 1);
    },
    [editNonce],
  );

  const handleGenerateMc = useCallback(() => launchMc(true), [launchMc]);

  const handleRecalculate = useCallback(() => {
    if (activeSolve) return; // a solve owns the run while in flight
    // If the Base PoS was never cached (e.g. the auto-run failed), re-include
    // Base so a retry can recover it; once cached, Recalculate is working-only.
    launchMc(cachedBaseSuccess === null);
  }, [launchMc, activeSolve, cachedBaseSuccess]);

  // Auto-run MC once on first entry so both gauges populate without a click.
  // Never re-fires; after this, edits mark the Scenario stale and the user
  // presses Recalculate.
  const didAutoRunMc = useRef(false);
  useEffect(() => {
    if (didAutoRunMc.current) return;
    didAutoRunMc.current = true;
    handleGenerateMc();
  }, [handleGenerateMc]);

  const handleReset = useCallback(() => {
    setMutationMap(new Map());
    setComputeStatus("fresh");
    setCurrentProjection(initialSourceProjection);
    setSolvedPoS(null);
    setSolvedSeed(null);
    setEditNonce((n) => n + 1); // reset is an edit → Scenario goes stale
  }, [initialSourceProjection]);

  const [saveOpen, setSaveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [savingToBase, setSavingToBase] = useState(false);
  const [saveToBaseError, setSaveToBaseError] = useState<string | null>(null);

  async function handleSaveToBase() {
    if (!canEdit) return;
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
      // Keep any non-base-savable mutations (techniques) so they aren't lost —
      // the user can still save them as a scenario. Savable ones are now in base.
      setMutationMap((prev) => {
        const next = new Map<SolverMutationKey, SolverMutation>();
        for (const [k, m] of prev) if (!isBaseSavableMutation(m)) next.set(k, m);
        return next;
      });
      setSolvedPoS(null);
      setComputeStatus("fresh");
      router.refresh();
    } catch (err) {
      setSaveToBaseError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingToBase(false);
    }
  }

  async function handleSaveSubmit(args: { name: string }) {
    if (!canEdit) return;
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
          // Pass the seed from the canonical solve so the saved scenario's
          // report can reproduce the exact same PoS via getOrComputeMonteCarlo.
          ...(solvedSeed !== null ? { seed: solvedSeed } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { scenarioId: string };
      setSaveOpen(false);
      router.push(`/clients/${clientId}/cashflow?scenario=${data.scenarioId}`);
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
    // Any manual edit invalidates the prior solve's canonical PoS and seed.
    setSolvedPoS(null);
    setSolvedSeed(null);
    setEditNonce((n) => n + 1); // marks the Scenario PoS outdated
  }

  // Per-field reset: drop the given mutation keys from the map, mirroring
  // pushMutation's staleness side-effects (a reset is an edit). Clearing one or
  // more keys reverts those levers to their base/working values.
  const clearMutations = useCallback((keys: SolverMutationKey[]) => {
    setMutationMap((prev) => {
      if (!keys.some((k) => prev.has(k))) return prev;
      const next = new Map(prev);
      for (const k of keys) next.delete(k);
      return next;
    });
    setComputeStatus("stale");
    setSolvedPoS(null);
    setSolvedSeed(null);
    setEditNonce((n) => n + 1); // a per-field reset is an edit → Scenario stale
  }, []);

  const handleSolveStart = useCallback(
    (
      target: SolveLeverKey,
      targetPoS?: number,
      extraMutations: SolverMutation[] = [],
      extraMixes: { accountId: string; mix: { assetClassId: string; weight: number }[] }[] = [],
    ) => {
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
      // just to derive the key. Use workingTree (base + mutations), not the base
      // tree — a roth-conversion-amount lever added inside the workspace lives
      // only in the working tree, and buildLeverMutation throws if it can't find
      // the conversion (F4).
      const targetKey = mutationKey(buildLeverMutation(target, 0, workingTree));
      merged.delete(targetKey);
      // Merge caller-supplied per-account mixes over the memoized ones, with
      // extraMixes winning on accountId collision. Same flush-timing reason as
      // extraMutations: a just-created account's setSavingsAccountMixes hasn't
      // flushed yet, so extraAccountMixes is stale this render and would omit
      // the new account's mix — leaving it at MC's zero-variance fallback.
      const startMixes = [
        ...extraAccountMixes.filter((x) => !extraMixes.some((e) => e.accountId === x.accountId)),
        ...extraMixes,
      ];
      void solveController.start({
        source: initialSource,
        mutations: Array.from(merged.values()),
        target,
        targetPoS,
        extraAccountMixes: startMixes,
      });
    },
    [activeSolve, mutations, initialSource, solveController, workingTree, extraAccountMixes],
  );

  const handleSolveCancel = useCallback(() => {
    solveController.cancel();
    setActiveSolve(null);
  }, [solveController]);

  // Build the deletion mutations that retire a previously-minted, still-
  // uncommitted synthetic Additional Savings account (account + its rule), and
  // drop its MC mix. Returns the mutations so a concurrent solve can carry them
  // as baseline (pushMutation's state hasn't flushed when the solve starts).
  const retireSyntheticMutations = useCallback(
    (ids: { accountId: string; ruleId: string }): SolverMutation[] => {
      setSavingsAccountMixes((prev) => {
        if (!prev.has(ids.accountId)) return prev;
        const next = new Map(prev);
        next.delete(ids.accountId);
        return next;
      });
      return [
        { kind: "account-upsert", id: ids.accountId, value: null },
        { kind: "savings-rule-upsert", id: ids.ruleId, value: null },
      ];
    },
    [],
  );

  // "Solve minimum additional savings": stand up a real, savable account on the
  // chosen model portfolio's growth/realization + a fundFromExpenseReduction
  // rule at $0, push both into the baseline (so the search sees them), register
  // the portfolio's asset mix for MC, then goal-seek the rule's contribution
  // toward the target PoS. onResult writes back the solved annualAmount.
  const handleSolveMinSavings = useCallback(
    (modelPortfolioId: string, targetPoS: number) => {
      if (activeSolve) return;
      const owner = ownerOptions[0];
      if (!owner) return; // no owner → nothing to solve against
      const portfolio = modelPortfolios.find((p) => p.id === modelPortfolioId);
      if (!portfolio) return; // unknown portfolio → nothing to invest in
      // Capture working-tree year-0 living before the solve so onResult can show
      // the before→after delta of the expense-reduction self-funding.
      baselineLivingRef.current = currentProjection[0]?.expenses.living ?? 0;
      // Retire any prior UNCOMMITTED synthetic account before minting a new one,
      // so re-solving replaces rather than stacks a second self-funding rule.
      // (Committed accounts cleared the ref on include, so they're left alone.)
      const prevPending = pendingSyntheticRef.current;
      const retireMutations = prevPending ? retireSyntheticMutations(prevPending) : [];
      for (const m of retireMutations) pushMutation(m);
      const accountId = crypto.randomUUID();
      const ruleId = crypto.randomUUID();
      const { account, rule } = buildAdditionalSavingsAccount({
        ownerFamilyMemberId: owner.familyMemberId,
        startYear: currentYear,
        endYear: retirementYearForOwner(owner.familyMemberId),
        growthRate: portfolio.growthRate,
        realization: portfolio.realization,
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
      pendingSyntheticRef.current = { accountId, ruleId };
      setMinSavings({ accountId, ruleId, rule, portfolio, targetPoS });
      setMinSavingsResult(null);
      setSavingsAccountMixes((prev) => new Map(prev).set(accountId, portfolio.mix));
      // Pass the retire + account + rule as extra baseline mutations: pushMutation's
      // state updates haven't flushed yet, so the solve must be told about them
      // directly or the search range would resolve against a stale tree.
      handleSolveStart(
        { kind: "savings-contribution", accountId },
        targetPoS,
        [...retireMutations, accountMutation, ruleMutation],
        [{ accountId, mix: portfolio.mix }],
      );
    },
    // pushMutation is a plain component-scope function; its identity is
    // irrelevant here, so it's intentionally not a dependency.
    [
      activeSolve,
      ownerOptions,
      modelPortfolios,
      currentProjection,
      currentYear,
      retirementYearForOwner,
      retireSyntheticMutations,
      handleSolveStart,
    ],
  );

  // "Keep self-funding": the synthetic fundFromExpenseReduction rule is already
  // in the tree (written back by onResult). Surface THIS solve's account as an
  // editable box and commit it (clear the ref so a later solve won't retire it).
  const handleIncludeSelfFunding = useCallback(() => {
    if (!minSavingsResult) return;
    const acct = pendingSyntheticRef.current?.accountId;
    if (acct) setVisibleSelfFundingAccts((prev) => new Set(prev).add(acct));
    pendingSyntheticRef.current = null;
    setMinSavingsResult(null);
  }, [minSavingsResult]);

  // "Lock in cut": convert THIS solve's synthetic rule to a normal savings rule
  // and lower working-years living expenses by the year-0 expense-reduction
  // amount. Commits the account (clear the ref) so a later solve won't retire it.
  const handleIncludeLockInCut = useCallback(() => {
    if (!minSavingsResult) return;
    const ruleId = pendingSyntheticRef.current?.ruleId;
    const selfRule = ruleId
      ? workingTree.savingsRules.find((r) => r.id === ruleId)
      : undefined;
    if (!selfRule) { pendingSyntheticRef.current = null; setMinSavingsResult(null); return; }
    const normalRule: SavingsRule = {
      id: selfRule.id,
      accountId: selfRule.accountId,
      annualAmount: selfRule.annualAmount,
      isDeductible: selfRule.isDeductible,
      startYear: selfRule.startYear,
      endYear: selfRule.endYear,
      ...(selfRule.rothPercent != null ? { rothPercent: selfRule.rothPercent } : {}),
    };
    pushMutation({ kind: "savings-rule-upsert", id: normalRule.id, value: normalRule });
    for (const m of buildLockInCutMutations(
      workingTree.expenses,
      workingTree.planSettings.planStartYear,
      currentYear,
      minSavingsResult.fromExpenseReduction,
    )) {
      pushMutation(m);
    }
    setVisibleSelfFundingAccts((prev) => { const n = new Set(prev); n.delete(selfRule.accountId); return n; });
    pendingSyntheticRef.current = null;
    setMinSavingsResult(null);
  }, [minSavingsResult, workingTree, currentYear]);

  // "Dismiss": discard this solve. Retire the uncommitted synthetic account (and
  // prune its MC mix) so the projection returns to its pre-solve state — also
  // cleans up a mid-solve cancel, which leaves the just-added $0 account behind.
  const handleDismissResult = useCallback(() => {
    handleSolveCancel();
    const ids = pendingSyntheticRef.current;
    if (ids) {
      for (const m of retireSyntheticMutations(ids)) pushMutation(m);
      pendingSyntheticRef.current = null;
    }
    setMinSavings(null);
    setMinSavingsResult(null);
  }, [handleSolveCancel, retireSyntheticMutations]);

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
    <div className="flex h-[calc(100vh-100px)] flex-col">
      {/* 100px = Topbar 56 + collapsed ClientHeader 44 (existing app chrome) */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(360px,40%)_1fr]">
        {/* LEFT — inputs, independent scroll */}
        <div className="min-h-0 overflow-y-auto border-b border-hair lg:border-b-0 lg:border-r">
          <div
            role="tablist"
            aria-label="Solver editing surface"
            className="sticky top-0 z-10 flex gap-1 border-b border-hair-2 bg-card px-3 pt-0.5"
          >
            {LEFT_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={activeTab === t.id}
                onClick={() => handleTabChange(t.id)}
                className={
                  activeTab === t.id
                    ? "border-b-2 border-accent px-3 py-1 text-[13px] font-medium text-ink"
                    : "border-b-2 border-transparent px-3 py-1 text-[13px] text-ink-3 hover:text-ink"
                }
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="px-1 pb-4">
            {activeTab === "retirement" && (
              <>
                <SolverSection title="Goals">
              <div className="grid grid-cols-2 gap-x-5">
                <SolverRowRetirementAges
                  baseClient={baseClientData.client}
                  workingClient={workingTree.client}
                  onChange={pushMutation}
                  onResetField={clearMutations}
                  activeSolve={activeSolve}
                  onSolveStart={handleSolveStart}
                  onSolveCancel={handleSolveCancel}
                />
                <SolverRowLifeExpectancy
                  baseClient={baseClientData.client}
                  workingClient={workingTree.client}
                  onChange={pushMutation}
                  onResetField={clearMutations}
                />
              </div>
              <SolverRowLivingExpenseScale
                baseExpenses={baseClientData.expenses}
                workingExpenses={workingTree.expenses}
                currentYear={currentYear}
                onChange={pushMutation}
                onResetField={clearMutations}
                activeSolve={activeSolve}
                onSolveStart={handleSolveStart}
                onSolveCancel={handleSolveCancel}
              />
              <SolverRowSocialSecurity
                baseIncomes={baseClientData.incomes}
                workingIncomes={workingTree.incomes}
                baseClient={baseClientData.client}
                workingClient={workingTree.client}
                onChange={pushMutation}
                onResetField={clearMutations}
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
                onResetField={clearMutations}
              />
              <SolverRowSavingsContributions
                baseClientData={baseClientData}
                workingClientData={workingTree}
                currentYear={currentYear}
                onChange={pushMutation}
                onResetField={clearMutations}
                activeSolve={activeSolve}
                onSolveStart={handleSolveStart}
                onSolveCancel={handleSolveCancel}
                visibleSelfFundingAccts={visibleSelfFundingAccts}
              />
              <SolverQuickAddAccount
                owners={ownerOptions}
                existingAccounts={existingAddable}
                currentYear={currentYear}
                retirementYearForOwner={retirementYearForOwner}
                growthForType={(t) => growthForType(t, categoryGrowthDefaults)}
                onChange={pushMutation}
              />
              <SolverMinSavingsPanel
                portfolios={modelPortfolios}
                disabled={activeSolve !== null || ownerOptions.length === 0}
                phase={
                  activeSolve?.target.kind === "savings-contribution" &&
                  minSavings?.accountId ===
                    (activeSolve.target as { kind: "savings-contribution"; accountId: string }).accountId
                    ? "solving"
                    : minSavingsResult
                      ? "result"
                      : "idle"
                }
                progress={
                  activeSolve && minSavings
                    ? { iteration: activeSolve.iteration, candidateValue: activeSolve.candidateValue, achievedPoS: activeSolve.achievedPoS, targetPoS: minSavings.targetPoS }
                    : null
                }
                result={minSavingsResult}
                onSolve={handleSolveMinSavings}
                onIncludeSelfFunding={handleIncludeSelfFunding}
                onIncludeLockInCut={handleIncludeLockInCut}
                onDismissResult={handleDismissResult}
              />
            </SolverSection>
          </>
        )}

        {activeTab === "techniques" && (
          <SolverTechniquesTab
            clientId={clientId}
            workingTree={workingTree}
            accounts={(baseClientData.accounts ?? []).map((a) => ({
              id: a.id,
              name: a.name,
              category: a.category,
              subType: a.subType ?? "",
              ownerFamilyMemberId: controllingFamilyMember(a),
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
          <SolverLifeInsuranceInputs
            assumptions={liAssumptions}
            onAssumptionsChange={setLiAssumptions}
            liabilities={(baseClientData.liabilities ?? []).map((l) => ({
              id: l.id,
              name: l.name,
              balance: l.balance,
            }))}
            estateAdminExpenses={baseClientData.planSettings.estateAdminExpenses ?? 0}
            modelPortfolios={modelPortfolios}
          />
        )}

            {activeTab === "estate_planning" && (
              <SolverTabEstatePlanning
                baseClientData={baseClientData}
                clientData={workingTree}
                onChange={pushMutation}
              />
            )}
          </div>
        </div>

        {/* RIGHT — reports, scroll as one document */}
        <div className="min-h-0 overflow-y-auto">
          <div className="space-y-4 p-4">
            <SolverChartPanel
              currentProjection={currentProjection}
              baseProjection={baseProjection}
              workingTree={workingTree}
              computeStatus={computeStatus}
              clientId={clientId}
              liAssumptions={liAssumptions}
              clientName={clientName}
              spouseName={spouseName}
              activeReport={activeReport}
              onReportChange={setActiveReport}
              baseTree={baseClientData}
            />
            {activeReport === "lifeInsurance" ? (
              <SolverLifeInsuranceResults
                clientId={clientId}
                assumptions={liAssumptions}
                solveResult={liSolve.solveResult}
                isSolving={liSolve.isSolving}
                errorMessage={liSolve.errorMessage}
                clientName={clientName}
                spouseName={spouseName}
                onScoreChange={(s) =>
                  setLiAssumptions((a) => ({ ...a, mcTargetScore: s }))
                }
              />
            ) : null}
            <SolverKpiStrip
              posState={scenarioGauge.state}
              workingSuccess={scenarioGauge.successPct}
              baselineSuccess={baseSuccess}
              endingAssets={workingEndingAssets}
              endingAssetsDelta={endingAssetsDelta}
              yearsFunded={workingYearsFunded}
              yearsFundedDelta={workingYearsFunded - baseYearsFunded}
              lifetimeTax={workingLifetimeTax}
              lifetimeTaxDelta={workingLifetimeTax - baseLifetimeTax}
              dimmed={computeStatus === "computing"}
              onRegenerate={handleRecalculate}
              solveActive={activeSolve !== null}
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
          </div>
        </div>
      </div>

      <SolverActionBar
        hasMutations={mutations.length > 0}
        canSaveToBase={mutations.some(isBaseSavableMutation)}
        solveActive={activeSolve !== null}
        savingToBase={savingToBase}
        canEdit={canEdit}
        onReset={handleReset}
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
