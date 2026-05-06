"use client";

import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import type {
  ScenarioOption,
  SnapshotOption,
} from "@/components/scenario/scenario-picker-dropdown";
import { deriveComparisonData } from "./lib/derive-scrubber-data";
import { ComparisonCellView } from "./comparison-cell";

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
  scrubberYear: number;
  scenarios: ScenarioOption[];
  snapshots: SnapshotOption[];
}

export function ComparisonGrid(props: Props) {
  const data = deriveComparisonData({
    leftTree: props.leftTree,
    leftResult: props.leftResult,
    leftScenarioName: props.leftScenarioName,
    leftIsDoNothing: props.leftIsDoNothing,
    rightTree: props.rightTree,
    rightResult: props.rightResult,
    rightScenarioName: props.rightScenarioName,
    rightIsDoNothing: props.rightIsDoNothing,
    scrubberYear: props.scrubberYear,
  });

  return (
    <div className="grid grid-cols-3 gap-px overflow-hidden rounded bg-hair">
      <ComparisonCellView
        cell={data.left}
        side="left"
        clientId={props.clientId}
        scenarios={props.scenarios}
        snapshots={props.snapshots}
        pickerValue={props.leftScenarioId}
      />
      <ComparisonCellView
        cell={data.right}
        side="right"
        clientId={props.clientId}
        scenarios={props.scenarios}
        snapshots={props.snapshots}
        pickerValue={props.rightScenarioId}
      />
      <ComparisonCellView
        cell={data.delta}
        side="delta"
        clientId={props.clientId}
        scenarios={props.scenarios}
        snapshots={props.snapshots}
      />
    </div>
  );
}
