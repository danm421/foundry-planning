// src/lib/presentations/pages/retirement-comparison/view-model.ts
import type { BuildDataContext } from "@/components/presentations/registry";
import type { ClientData } from "@/engine/types";
import { resolveScenarioRef, keyForRef } from "@/lib/scenario/presentation-refs";
import { buildRetirementComparisonMetrics } from "./metrics";
import { describeChange } from "@/lib/presentations/pages/scenario-changes/describe";
import { groupUnits } from "@/lib/presentations/pages/scenario-changes/group";
import type { RetirementComparisonOptions, RetirementComparisonPageData } from "./types";

function retirementYearOf(clientData: ClientData): number | null {
  const { retirementAge, dateOfBirth } = clientData.client;
  const birthYear = new Date(dateOfBirth).getUTCFullYear();
  if (!Number.isFinite(birthYear) || !Number.isFinite(retirementAge)) return null;
  return birthYear + retirementAge;
}

const EMPTY = (title: string): RetirementComparisonPageData => ({
  title,
  subtitle: "",
  isEmpty: true,
  kpis: [], overlay: [], matrix: null, changeUnits: [],
  showChanges: false, showPortfolioMatrix: false, showAiSummary: false,
  aiMarkdown: "",
});

export function buildRetirementComparisonData(
  ctx: BuildDataContext,
  options: RetirementComparisonOptions,
): RetirementComparisonPageData {
  const title = "Retirement Comparison";
  const byRef = ctx.bundlesByRef ?? {};
  const baseBundle = byRef[keyForRef(resolveScenarioRef("base"))];
  const scnBundle = options.scenarioId
    ? byRef[keyForRef(resolveScenarioRef(options.scenarioId))]
    : undefined;

  if (!baseBundle || !scnBundle || scnBundle.projection.years.length === 0) {
    return EMPTY(title);
  }

  const baseYears = baseBundle.projection.years;
  const scenarioYears = scnBundle.projection.years;
  const retirementYear =
    retirementYearOf(scnBundle.clientData) ?? scenarioYears[0]?.year ?? 0;

  const metrics = buildRetirementComparisonMetrics({
    baseYears,
    scenarioYears,
    baseSuccess: baseBundle.monteCarlo?.summary.successRate ?? null,
    scenarioSuccess: scnBundle.monteCarlo?.summary.successRate ?? null,
    retirementYear,
  });

  // Changes made (scenario vs base), reusing the scenario-changes describe+group.
  const sc = scnBundle.scenarioChanges;
  let changeUnits: RetirementComparisonPageData["changeUnits"] = [];
  if (sc && sc.changes.length > 0) {
    const described = sc.changes.map((change) => ({
      change,
      row: describeChange(change, { targetNames: sc.targetNames }),
    }));
    changeUnits = groupUnits(described, sc.toggleGroups);
  }

  return {
    title,
    subtitle: `Base Case vs. ${scnBundle.scenarioLabel}`,
    isEmpty: false,
    kpis: metrics.kpis,
    overlay: metrics.overlay,
    matrix: metrics.matrix,
    changeUnits,
    showChanges: options.showChanges,
    showPortfolioMatrix: options.showPortfolioMatrix,
    showAiSummary: options.showAiSummary,
    aiMarkdown: options.ai.generatedText,
  };
}
