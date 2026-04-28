"use client";

import { useState } from "react";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import { ChipBar } from "./chip-bar";
import { AssumptionsModal } from "./assumptions-modal";
import { YearScrubber } from "./year-scrubber";
import { ComparisonGrid } from "./comparison-grid";
import { TrajectoryChart } from "./trajectory-chart";
import { StrategyCards } from "./strategy-cards";

interface Props {
  tree: ClientData;
  withResult: ProjectionResult;
  withoutResult: ProjectionResult;
  procrastinatedResult: ProjectionResult | null;
  clientId: string;
}

/**
 * Client wrapper composing the projection chip bar, year scrubber, and
 * assumptions modal. Comparison grid / trajectory chart / strategy cards
 * land in Phases 6-8 (Tasks 26 / 28 / 29) — placeholder lines above mark
 * the drop-in spots.
 *
 * Token translations from the plan pseudocode:
 *   rounded-card → rounded
 *   bg-bg-0      → bg-card
 *
 * AssumptionsModal here uses the always-mounted `open: boolean` shape
 * (verified against assumptions-modal.tsx Task 22 implementation).
 */
export function ProjectionPanel({
  tree,
  withResult,
  withoutResult,
  procrastinatedResult,
  clientId,
}: Props) {
  const startYear = tree.planSettings.planStartYear;
  const firstDeathYear = withResult.firstDeathEvent?.year;
  const secondDeathYear = withResult.secondDeathEvent?.year;
  const finalDeathYear = secondDeathYear ?? firstDeathYear ?? startYear + 30;

  const [scrubberYear, setScrubberYear] = useState<number>(finalDeathYear);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);

  return (
    <section className="space-y-6 rounded border border-hair bg-card p-6">
      <ChipBar
        clientId={clientId}
        planSettings={tree.planSettings}
        onOpenAssumptions={() => setAssumptionsOpen(true)}
      />
      <YearScrubber
        currentYear={startYear}
        firstDeathYear={firstDeathYear}
        secondDeathYear={secondDeathYear}
        value={scrubberYear}
        onChange={setScrubberYear}
      />
      <ComparisonGrid
        tree={tree}
        withResult={withResult}
        withoutResult={withoutResult}
        scrubberYear={scrubberYear}
      />
      <TrajectoryChart
        tree={tree}
        withResult={withResult}
        withoutResult={withoutResult}
        scrubberYear={scrubberYear}
      />
      <StrategyCards
        tree={tree}
        withResult={withResult}
        procrastinatedResult={procrastinatedResult}
      />

      <AssumptionsModal
        open={assumptionsOpen}
        clientId={clientId}
        planSettings={tree.planSettings}
        onClose={() => setAssumptionsOpen(false)}
      />
    </section>
  );
}
