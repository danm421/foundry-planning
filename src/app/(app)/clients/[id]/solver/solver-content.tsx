import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjection } from "@/engine";
import { loadGiftDrafts } from "@/lib/estate/load-gift-drafts";
import { db } from "@/db";
import { modelPortfolios, modelPortfolioAllocations, scenarios } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { buildClientMilestones } from "@/lib/milestones";
import { loadLifeInsuranceSettings } from "@/lib/life-insurance/settings";
import { assembleSolverPortfolios, type SolverModelPortfolio } from "@/lib/solver/model-portfolio-config";
import { LiveSolverWorkspace } from "./live-solver-workspace";

interface Props {
  clientId: string;
  firmId: string;
  source: string;
}

export async function SolverContent({ clientId, firmId, source }: Props) {
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

  const baseProjection = runProjection(baseLoaded.effectiveTree);
  const sourceProjection = sourceLoaded
    ? runProjection(sourceLoaded.effectiveTree)
    : baseProjection;

  const [modelPortfolioRows, allocationRows, baseGifts] = await Promise.all([
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

  const milestones = buildClientMilestones(
    baseLoaded.effectiveTree.client,
    baseLoaded.effectiveTree.planSettings.planStartYear,
    baseLoaded.effectiveTree.planSettings.planEndYear,
  );

  const lifeInsuranceSettings = await loadLifeInsuranceSettings(
    clientId,
    baseLoaded.effectiveTree,
  );

  // Display names for the Life Insurance tab's need cards / survivor chart.
  // Fall back to generic labels when a name is missing.
  const baseClient = baseLoaded.effectiveTree.client;
  const clientName = baseClient.firstName?.trim() || "Client";
  const spouseName = baseClient.spouseName?.trim() || "Spouse";

  return (
    <LiveSolverWorkspace
      // Remount when the right-column source changes. The workspace stashes
      // initialSource* props into useState; a searchParam-only navigation
      // preserves the instance, so without a key the chart keeps showing the
      // previous source's projection.
      key={source}
      clientId={clientId}
      baseClientData={baseLoaded.effectiveTree}
      baseProjection={baseProjection}
      initialSource={source}
      initialSourceClientData={sourceLoaded?.effectiveTree ?? baseLoaded.effectiveTree}
      initialSourceProjection={sourceProjection}
      modelPortfolios={solverPortfolios}
      milestones={milestones}
      lifeInsuranceSettings={lifeInsuranceSettings}
      clientName={clientName}
      spouseName={spouseName}
      categoryGrowthDefaults={categoryGrowthDefaults}
      scenarioName={scenarioName}
      baseGifts={baseGifts}
    />
  );
}
