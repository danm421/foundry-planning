/**
 * ComparisonGrid — 3-column wrapper (without / with / impact) for the
 * estate-planning projection comparison panel (Task 26).
 *
 * Calls `deriveScrubberData` once per render with the current scrubberYear
 * and renders three `<ComparisonCell>` siblings. The `gap-px` + `bg-hair`
 * faux-border trick produces 1px hairlines between cells without explicit
 * separator markup.
 *
 * Note: `ProjectionResult` is imported from `@/engine/projection`, not
 * `@/engine/types` (Task 25's dependency-graph finding).
 */

import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import { deriveScrubberData } from "./lib/derive-scrubber-data";
import { ComparisonCell } from "./comparison-cell";

interface Props {
  tree: ClientData;
  withResult: ProjectionResult;
  withoutResult: ProjectionResult;
  scrubberYear: number;
}

export function ComparisonGrid({
  tree,
  withResult,
  withoutResult,
  scrubberYear,
}: Props) {
  const data = deriveScrubberData({
    tree,
    withResult,
    withoutResult,
    scrubberYear,
  });
  return (
    <div className="grid grid-cols-3 gap-px overflow-hidden rounded bg-hair">
      <ComparisonCell cell={data.without} variant="without" />
      <ComparisonCell cell={data.with} variant="with" />
      <ComparisonCell cell={data.impact} variant="impact" />
    </div>
  );
}
