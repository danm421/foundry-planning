"use client";

import { useMemo } from "react";
import { runProjectionWithEvents } from "@/engine/projection";
import {
  rankTrustsByContribution,
  synthesizeDelayedTopGift,
} from "@/lib/estate/strategy-attribution";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import type {
  ScenarioOption,
  SnapshotOption,
} from "@/components/scenario/scenario-picker-dropdown";
import { ProjectionPanel } from "@/app/(app)/clients/[id]/estate-planning/projection/projection-panel";

export interface EstateFlowComparisonTabProps {
  clientId: string;
  /** The currently-active EstateFlow scenario, used for the right side. */
  rightScenarioId: string;
  rightScenarioName: string;
  /** Live, sandbox-edited tree from the EstateFlow view. */
  engineData: ClientData;
  /** Live projection over `engineData`. */
  projection: ProjectionResult;
  /** Do-nothing counterfactual loaded server-side; the left baseline. */
  leftTree: ClientData;
  leftResult: ProjectionResult;
  leftScenarioName: string;
  scenarios: ScenarioOption[];
  snapshots: SnapshotOption[];
}

export function EstateFlowComparisonTab(props: EstateFlowComparisonTabProps) {
  // Procrastination card data is computed client-side here (vs. server-side on
  // the Planning page) because the right tree updates live with sandbox edits.
  // The branch matches estate-planning-content.tsx: only synthesize when at
  // least one irrevocable trust gift exists.
  const procrastinatedResult = useMemo<ProjectionResult | null>(() => {
    const ranked = rankTrustsByContribution(props.engineData, props.projection.years);
    if (ranked.length === 0) return null;
    return runProjectionWithEvents(synthesizeDelayedTopGift(props.engineData, 10));
  }, [props.engineData, props.projection.years]);

  return (
    <ProjectionPanel
      clientId={props.clientId}
      leftTree={props.leftTree}
      leftResult={props.leftResult}
      leftScenarioId="do-nothing"
      leftScenarioName={props.leftScenarioName}
      leftIsDoNothing
      rightTree={props.engineData}
      rightResult={props.projection}
      rightScenarioId={props.rightScenarioId}
      rightScenarioName={props.rightScenarioName}
      rightIsDoNothing={false}
      procrastinatedResult={procrastinatedResult}
      scenarios={props.scenarios}
      snapshots={props.snapshots}
      embedded
    />
  );
}
