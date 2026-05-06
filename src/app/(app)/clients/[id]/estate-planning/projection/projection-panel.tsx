"use client";

import { useState } from "react";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import type {
  ScenarioOption,
  SnapshotOption,
} from "@/components/scenario/scenario-picker-dropdown";
import { ChipBar } from "./chip-bar";
import { AssumptionsModal } from "./assumptions-modal";
import { YearScrubber } from "./year-scrubber";
import { ComparisonGrid } from "./comparison-grid";
import { TrajectoryChart } from "./trajectory-chart";
import { StrategyCards } from "./strategy-cards";

interface Props {
  clientId: string;
  leftTree: ClientData;
  leftResult: ProjectionResult;
  leftScenarioId: string;
  leftScenarioName: string;
  leftIsDoNothing: boolean;
  rightTree: ClientData;
  rightResult: ProjectionResult;
  rightScenarioId: string;
  rightScenarioName: string;
  rightIsDoNothing: boolean;
  procrastinatedResult: ProjectionResult | null;
  scenarios: ScenarioOption[];
  snapshots: SnapshotOption[];
}

export function ProjectionPanel(props: Props) {
  const startYear = props.rightTree.planSettings.planStartYear;
  const firstDeathYear = props.rightResult.firstDeathEvent?.year;
  const secondDeathYear = props.rightResult.secondDeathEvent?.year;
  const finalDeathYear = secondDeathYear ?? firstDeathYear ?? startYear + 30;

  const [scrubberYear, setScrubberYear] = useState<number>(finalDeathYear);
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);

  return (
    <section className="space-y-6 rounded border border-hair bg-card p-6">
      <ChipBar
        clientId={props.clientId}
        planSettings={props.rightTree.planSettings}
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
        clientId={props.clientId}
        leftTree={props.leftTree}
        leftResult={props.leftResult}
        leftScenarioId={props.leftScenarioId}
        leftScenarioName={props.leftScenarioName}
        leftIsDoNothing={props.leftIsDoNothing}
        rightTree={props.rightTree}
        rightResult={props.rightResult}
        rightScenarioId={props.rightScenarioId}
        rightScenarioName={props.rightScenarioName}
        rightIsDoNothing={props.rightIsDoNothing}
        scrubberYear={scrubberYear}
        scenarios={props.scenarios}
        snapshots={props.snapshots}
      />
      <TrajectoryChart
        leftTree={props.leftTree}
        leftResult={props.leftResult}
        rightTree={props.rightTree}
        rightResult={props.rightResult}
        scrubberYear={scrubberYear}
      />
      <StrategyCards
        tree={props.rightTree}
        rightResult={props.rightResult}
        rightIsDoNothing={props.rightIsDoNothing}
        procrastinatedResult={props.procrastinatedResult}
      />

      <AssumptionsModal
        open={assumptionsOpen}
        clientId={props.clientId}
        planSettings={props.rightTree.planSettings}
        onClose={() => setAssumptionsOpen(false)}
      />
    </section>
  );
}
