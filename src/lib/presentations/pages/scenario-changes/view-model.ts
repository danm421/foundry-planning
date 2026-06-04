import type { ScenarioChangesContext, ScenarioChangesOptions, ScenarioChangesPageData } from "./types";
import { describeChange } from "./describe";
import { groupUnits } from "./group";
import { buildResolveContext, EMPTY_RESOLVE_DATA } from "./describe/resolve";

export function buildScenarioChangesData(
  scenarioChanges: ScenarioChangesContext | undefined,
  options: ScenarioChangesOptions,
): ScenarioChangesPageData {
  const sc = scenarioChanges;

  if (!sc || sc.changes.length === 0) {
    return { title: options.title, subtitle: "", units: [], showExplanations: options.showExplanations, isEmpty: true };
  }

  const resolve = buildResolveContext(sc.resolve ?? EMPTY_RESOLVE_DATA);
  const ctx = { targetNames: sc.targetNames, resolve };
  const described = sc.changes.map((change) => ({ change, row: describeChange(change, ctx) }));
  const units = groupUnits(described, sc.toggleGroups);

  return {
    title: options.title,
    subtitle: `What's different from ${sc.baseLabel}`,
    units,
    showExplanations: options.showExplanations,
    isEmpty: false,
  };
}
