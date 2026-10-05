import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjection } from "@/engine";
import { loadGiftDraftState } from "@/lib/estate/load-gift-drafts";
import { db } from "@/db";
import { modelPortfolios, modelPortfolioAllocations, scenarios } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { treeMilestones } from "@/lib/milestones";
import { loadLifeInsuranceSettings } from "@/lib/life-insurance/settings";
import { assembleSolverPortfolios, mixFromAllocationRows, type SolverModelPortfolio } from "@/lib/solver/model-portfolio-config";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import {
  buildGoalReturnStats,
  type GoalReturnStat,
} from "@/lib/reports/goal-mc-inputs";
import { canHaveGoalFunding, goalDrawAccountIds } from "@/engine/goals/goal-funding";
import { loadReportLayout } from "@/lib/solver/report-layout-store";
import { loadPanelData } from "@/lib/scenario/load-panel-data";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";
import { detectDefaultGrowthAtInflationFor } from "@/lib/investments/default-growth-at-inflation";
import { LiveSolverWorkspace } from "./live-solver-workspace";
import type { InputTab, ReportKey } from "./report-tab-link";

// Deterministic fallback seed when the plan MC data can't be loaded (never
// Math.random/Date — the per-goal gauges must reproduce across renders).
const FALLBACK_GOAL_SEED = 1;

interface Props {
  clientId: string;
  firmId: string;
  /** Authenticated advisor id — scopes the browser-side working-state draft. */
  userId: string;
  source: string;
  /** The views open when the page loads, from `?tab=` / `?report=`. */
  initialTab: InputTab;
  initialReport: ReportKey;
}

export async function SolverContent({
  clientId,
  firmId,
  userId,
  source,
  initialTab,
  initialReport,
}: Props) {
  const [baseLoaded, sourceLoaded, scenarioRow, changesPanel] = await Promise.all([
    loadEffectiveTree(clientId, firmId, "base", {}),
    source === "base"
      ? null
      : loadEffectiveTree(clientId, firmId, source, {}),
    source === "base"
      ? null
      : db
          .select({ name: scenarios.name })
          .from(scenarios)
          .where(and(eq(scenarios.id, source), eq(scenarios.clientId, clientId)))
          .then((rows) => rows[0] ?? null),
    source === "base"
      ? null
      : loadPanelData(clientId, source, firmId),
  ]);
  const scenarioName = scenarioRow?.name ?? null;

  // The scenario's own context: its growth & inflation settings resolve at load
  // time (W9), so the base context would show the base plan's defaults.
  const growthContext = (sourceLoaded ?? baseLoaded).resolutionContext;
  const growthResolver = growthContext?.resolver;
  const categoryGrowthDefaults = {
    taxable: growthResolver?.resolveCategoryDefault("taxable").rate ?? 0.06,
    retirement: growthResolver?.resolveCategoryDefault("retirement").rate ?? 0.06,
    cash: growthResolver?.resolveCategoryDefault("cash").rate ?? 0.02,
  };

  // Both trees' horizons already follow their life expectancies: the loaders
  // re-derive planEndYear rather than trusting the stored column.
  const baseTree = baseLoaded.effectiveTree;
  const sourceTree = sourceLoaded?.effectiveTree ?? null;

  const baseProjection = runProjection(baseTree);
  const sourceProjection = sourceTree
    ? runProjection(sourceTree)
    : baseProjection;

  const [modelPortfolioRows, allocationRows, giftState, reportLayout] = await Promise.all([
    db
      .select({ id: modelPortfolios.id, name: modelPortfolios.name })
      .from(modelPortfolios)
      .where(eq(modelPortfolios.firmId, firmId)),
    db
      .select({
        modelPortfolioId: modelPortfolioAllocations.modelPortfolioId,
        assetClassId: modelPortfolioAllocations.assetClassId,
        weight: modelPortfolioAllocations.weight,
      })
      .from(modelPortfolioAllocations)
      .innerJoin(modelPortfolios, eq(modelPortfolioAllocations.modelPortfolioId, modelPortfolios.id))
      .where(eq(modelPortfolios.firmId, firmId)),
    loadGiftDraftState(clientId, firmId, source),
    loadReportLayout(userId),
  ]);

  const allocsByPortfolio = new Map<string, { assetClassId: string; weight: string }[]>();
  for (const a of allocationRows) {
    const list = allocsByPortfolio.get(a.modelPortfolioId) ?? [];
    list.push({ assetClassId: a.assetClassId, weight: a.weight });
    allocsByPortfolio.set(a.modelPortfolioId, list);
  }

  const solverPortfolios: SolverModelPortfolio[] = growthResolver
    ? assembleSolverPortfolios(modelPortfolioRows, allocsByPortfolio, (id) => growthResolver.resolvePortfolio(id))
    : [];

  // MC asset mix for the retirement category default ("Plan default" growth).
  // Only a model-portfolio default carries a mix; custom/inflation defaults grow
  // deterministically, so their mix is empty. An inline Roth created on "Plan
  // default" registers this so its converted dollars are randomized in MC, the
  // same as a DB account would be.
  const retirementDefaultPortfolioId =
    growthResolver?.getCategoryGrowthSource("retirement") === "model_portfolio"
      ? growthResolver.categoryDefaultPortfolioId("retirement")
      : null;
  // Resolve from the raw allocation rows (same source assembleSolverPortfolios
  // folds), not the derived solverPortfolios picklist — that array is built for
  // the model-portfolio UI and could be filtered/reshaped for that purpose.
  const retirementDefaultMix = retirementDefaultPortfolioId
    ? mixFromAllocationRows(allocsByPortfolio.get(retirementDefaultPortfolioId) ?? [])
    : [];

  const milestones = treeMilestones(baseTree);

  // Per-goal POS gauge inputs. The gauge simulates each goal's dedicated pool
  // client-side; the blended return stats + scenario seed come from the plan
  // Monte Carlo data (same asset-class stats + account mixes). Gated on there
  // being at least one goal with a savings account, so the common no-goal case
  // skips the extra MC-data load entirely. Kicked off before
  // the life-insurance-settings await below so the two independent loads run
  // in parallel on this page's server-render path; a load failure resolves to
  // null and takes the neutral-fallback branch.
  const solverTree = sourceTree ?? baseTree;

  // Same untouched-defaults check the Net Worth tab runs. Counts the tree this
  // surface DISPLAYS, with that tree's context: both the CATEGORY source and
  // an account's own growthSource are scenario-scoped, so reading the base
  // here would report a different count than Net Worth for the same scenario.
  const defaultGrowthWarning = detectDefaultGrowthAtInflationFor(
    growthContext,
    solverTree.accounts,
  );
  const solverAccountById = new Map(solverTree.accounts.map((a) => [a.id, a]));
  const hasFundedGoals = solverTree.expenses.some(
    (e) => canHaveGoalFunding(e) && goalDrawAccountIds(e, solverAccountById).length > 0,
  );
  const goalMcPromise = hasFundedGoals
    ? loadMonteCarloData(clientId, firmId, source, [], solverTree).catch(() => null)
    : null;

  const lifeInsuranceSettings = await loadLifeInsuranceSettings(
    clientId,
    baseTree,
  );

  // Display names for the Life Insurance tab's need cards / survivor chart.
  // Fall back to generic labels when a name is missing.
  const baseClient = baseTree.client;
  const clientName = baseClient.firstName?.trim() || "Client";
  const spouseName = baseClient.spouseName?.trim() || CO_CLIENT_LABEL;

  let goalReturnStats: Record<string, GoalReturnStat> = {};
  let goalSeed = FALLBACK_GOAL_SEED;
  const mcData = goalMcPromise ? await goalMcPromise : null;
  if (mcData) {
    try {
      goalSeed = mcData.seed;
      const assetClassStats = new Map<string, GoalReturnStat>(
        mcData.indices.map((i) => [i.id, { arithMean: i.arithMean, stdDev: i.stdDev }]),
      );
      // The fromYear-0 segment is the base mix — the right allocation for
      // near-term goals. An account with no base mix may still carry
      // a reinvestment's later segment; it stays fixed-rate here.
      const accountMixes = mcData.accountMixes.map((m) => ({
        accountId: m.accountId,
        mix: m.segments.find((s) => s.fromYear === 0)?.mix ?? [],
      }));
      goalReturnStats = buildGoalReturnStats({
        expenses: solverTree.expenses,
        accounts: solverTree.accounts,
        accountMixes,
        assetClassStats,
      });
    } catch {
      // Stats assembly failed (e.g. malformed asset-class stats) — the panel
      // falls back to its neutral per-goal default for every goal.
    }
  }

  return (
    <LiveSolverWorkspace
      // Remount when the right-column source changes. The workspace stashes
      // initialSource* props into useState; a searchParam-only navigation
      // preserves the instance, so without a key the chart keeps showing the
      // previous source's projection.
      key={source}
      clientId={clientId}
      userId={userId}
      baseClientData={baseTree}
      baseProjection={baseProjection}
      initialSource={source}
      initialSourceClientData={sourceTree ?? baseTree}
      initialSourceProjection={sourceProjection}
      modelPortfolios={solverPortfolios}
      milestones={milestones}
      lifeInsuranceSettings={lifeInsuranceSettings}
      clientName={clientName}
      spouseName={spouseName}
      categoryGrowthDefaults={categoryGrowthDefaults}
      retirementDefaultMix={retirementDefaultMix}
      scenarioName={scenarioName}
      baseGifts={giftState.drafts}
      overlayGiftSeriesIds={giftState.overlaySeriesIds}
      goalReturnStats={goalReturnStats}
      goalSeed={goalSeed}
      initialReportLayout={reportLayout}
      initialTab={initialTab}
      initialReport={initialReport}
      defaultGrowthWarning={defaultGrowthWarning}
      changesPanel={changesPanel}
    />
  );
}
