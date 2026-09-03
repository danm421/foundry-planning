import type { BuildDataContext } from "@/components/presentations/registry";
import { resolveScenarioRef, keyForRef } from "@/lib/scenario/presentation-refs";
import type { ScenarioChangesOptions, ScenarioChangesPageData } from "./types";
import { describeChange } from "./describe";
import { groupUnits } from "./group";
import { buildResolveContext, EMPTY_RESOLVE_DATA } from "./describe/resolve";
import { titleFor } from "./options-schema";

function empty(
  options: ScenarioChangesOptions,
  emptyReason: NonNullable<ScenarioChangesPageData["emptyReason"]>,
): ScenarioChangesPageData {
  return {
    title: titleFor(options),
    subtitle: "",
    units: [],
    showExplanations: options.showExplanations,
    isEmpty: true,
    emptyReason,
  };
}

export function buildScenarioChangesData(
  ctx: BuildDataContext,
  options: ScenarioChangesOptions,
): ScenarioChangesPageData {
  // Like the other comparison reports, the scenario lives in this page's own
  // options rather than the deck's scenario picker: the baseline is always Base
  // Case, so a per-page "base facts" override would have nothing to compare.
  if (!options.scenarioId) return empty(options, "unselected");

  const bundle =
    (ctx.bundlesByRef ?? {})[keyForRef(resolveScenarioRef(options.scenarioId))];
  const sc = bundle?.scenarioChanges;

  if (!sc || sc.changes.length === 0) return empty(options, "no-changes");

  const resolve = buildResolveContext(sc.resolve ?? EMPTY_RESOLVE_DATA);
  const describeCtx = { targetNames: sc.targetNames, resolve };
  const described = sc.changes.map((change) => ({ change, row: describeChange(change, describeCtx) }));
  const units = groupUnits(described, sc.toggleGroups);

  return {
    title: titleFor(options),
    subtitle: `What's different from ${sc.baseLabel}`,
    units,
    showExplanations: options.showExplanations,
    isEmpty: false,
  };
}
