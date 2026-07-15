import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjection } from "@/engine";
import { loadGiftDrafts } from "@/lib/estate/load-gift-drafts";
import { db } from "@/db";
import { modelPortfolios, modelPortfolioAllocations, scenarios } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { buildClientMilestones } from "@/lib/milestones";
import { applyLifeExpectancyHorizon } from "@/lib/plan-horizon";
import { loadLifeInsuranceSettings } from "@/lib/life-insurance/settings";
import { assembleSolverPortfolios, mixFromAllocationRows, type SolverModelPortfolio } from "@/lib/solver/model-portfolio-config";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import {
  buildEducationReturnStats,
  type EducationReturnStat,
} from "@/lib/reports/education-mc-inputs";
import { loadReportLayout } from "@/lib/solver/report-layout-store";
import { LiveSolverWorkspace } from "./live-solver-workspace";

// Deterministic fallback seed when the plan MC data can't be loaded (never
// Math.random/Date — the per-goal gauges must reproduce across renders).
const FALLBACK_EDUCATION_SEED = 1;

interface Props {
  clientId: string;
  firmId: string;
  /** Authenticated advisor id — scopes the browser-side working-state draft. */
  userId: string;
  source: string;
}

export async function SolverContent({ clientId, firmId, userId, source }: Props) {
  const [baseLoaded, sourceLoaded, scenarioRow] = await Promise.all([
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
  ]);
  const scenarioName = scenarioRow?.name ?? null;

  const growthResolver = baseLoaded.resolutionContext?.resolver;
  const categoryGrowthDefaults = {
    taxable: growthResolver?.resolveCategoryDefault("taxable").rate ?? 0.06,
    retirement: growthResolver?.resolveCategoryDefault("retirement").rate ?? 0.06,
    cash: growthResolver?.resolveCategoryDefault("cash").rate ?? 0.02,
  };

  // Re-derive each side's plan horizon from its life expectancies before
  // projecting. The scenario (right column) re-derives its horizon whenever a
  // life-expectancy lever moves (see applyMutations), but a loaded tree carries
  // its *stored* planEndYear, which can lag the life-expectancy-implied horizon.
  // Left unreconciled the base projection stops early and the portfolio
  // comparison chart paints the scenario's extra trailing years as "identical
  // to base" (an all-blue floor). Normalizing both sides keeps them on the same
  // year grid; it's a no-op for trees whose stored horizon is already correct.
  const baseTree = applyLifeExpectancyHorizon(baseLoaded.effectiveTree);
  const sourceTree = sourceLoaded
    ? applyLifeExpectancyHorizon(sourceLoaded.effectiveTree)
    : null;

  const baseProjection = runProjection(baseTree);
  const sourceProjection = sourceTree
    ? runProjection(sourceTree)
    : baseProjection;

  const [modelPortfolioRows, allocationRows, baseGifts, reportLayout] = await Promise.all([
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
    loadGiftDrafts(clientId, firmId, source),
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

  const milestones = buildClientMilestones(
    baseTree.client,
    baseTree.planSettings.planStartYear,
    baseTree.planSettings.planEndYear,
  );

  // Per-goal education POS gauge inputs. The gauge simulates each goal's
  // dedicated pool client-side; the blended return stats + scenario seed come
  // from the plan Monte Carlo data (same asset-class stats + account mixes).
  // Gated on there being at least one funded education goal, so the common
  // no-education case skips the extra MC-data load entirely. Kicked off before
  // the life-insurance-settings await below so the two independent loads run
  // in parallel on this page's server-render path; a load failure resolves to
  // null and takes the neutral-fallback branch.
  const solverTree = sourceTree ?? baseTree;
  const hasEducationGoals = solverTree.expenses.some(
    (e) => e.type === "education" && (e.dedicatedAccountIds?.length ?? 0) > 0,
  );
  const educationMcPromise = hasEducationGoals
    ? loadMonteCarloData(clientId, firmId, source).catch(() => null)
    : null;

  const lifeInsuranceSettings = await loadLifeInsuranceSettings(
    clientId,
    baseTree,
  );

  // Display names for the Life Insurance tab's need cards / survivor chart.
  // Fall back to generic labels when a name is missing.
  const baseClient = baseTree.client;
  const clientName = baseClient.firstName?.trim() || "Client";
  const spouseName = baseClient.spouseName?.trim() || "Spouse";

  let educationReturnStats: Record<string, EducationReturnStat> = {};
  let educationSeed = FALLBACK_EDUCATION_SEED;
  const mcData = educationMcPromise ? await educationMcPromise : null;
  if (mcData) {
    try {
      educationSeed = mcData.seed;
      const assetClassStats = new Map<string, EducationReturnStat>(
        mcData.indices.map((i) => [i.id, { arithMean: i.arithMean, stdDev: i.stdDev }]),
      );
      // Segments are sorted ascending by fromYear, so [0] is the base mix —
      // the right allocation for near-term education goals.
      const accountMixes = mcData.accountMixes.map((m) => ({
        accountId: m.accountId,
        mix: m.segments[0]?.mix ?? [],
      }));
      educationReturnStats = buildEducationReturnStats({
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
      baseGifts={baseGifts}
      educationReturnStats={educationReturnStats}
      educationSeed={educationSeed}
      initialReportLayout={reportLayout}
    />
  );
}
