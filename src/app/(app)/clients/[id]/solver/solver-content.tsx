import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjection } from "@/engine";
import { db } from "@/db";
import { scenarios, modelPortfolios } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { buildClientMilestones } from "@/lib/milestones";
import { loadLifeInsuranceSettings } from "@/lib/life-insurance/settings";
import { LiveSolverWorkspace } from "./live-solver-workspace";

interface Props {
  clientId: string;
  firmId: string;
  source: string;
}

export async function SolverContent({ clientId, firmId, source }: Props) {
  const [baseLoaded, sourceLoaded] = await Promise.all([
    loadEffectiveTree(clientId, firmId, "base", {}),
    source === "base"
      ? null
      : loadEffectiveTree(clientId, firmId, source, {}),
  ]);

  const baseProjection = runProjection(baseLoaded.effectiveTree);
  const sourceProjection = sourceLoaded
    ? runProjection(sourceLoaded.effectiveTree)
    : baseProjection;

  const [scenarioRows, modelPortfolioRows] = await Promise.all([
    db
      .select({ id: scenarios.id, name: scenarios.name })
      .from(scenarios)
      .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, false))),
    db
      .select({ id: modelPortfolios.id, name: modelPortfolios.name })
      .from(modelPortfolios)
      .where(eq(modelPortfolios.firmId, firmId)),
  ]);

  const milestones = buildClientMilestones(
    baseLoaded.effectiveTree.client,
    baseLoaded.effectiveTree.planSettings.planStartYear,
    baseLoaded.effectiveTree.planSettings.planEndYear,
  );

  const lifeInsuranceSettings = await loadLifeInsuranceSettings(
    clientId,
    baseLoaded.effectiveTree,
  );

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
      availableScenarios={scenarioRows}
      modelPortfolios={modelPortfolioRows}
      milestones={milestones}
      lifeInsuranceSettings={lifeInsuranceSettings}
    />
  );
}
