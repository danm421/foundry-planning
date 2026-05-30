"use client";

import type { ClientData, ProjectionYear } from "@/engine/types";
import type { RetirementSummary } from "@/lib/analysis/derive-retirement-summary";
import { RetirementAnalysisView } from "@/components/analysis/retirement/retirement-analysis-view";

interface Props {
  clientId: string;
  source: string;
  tree: ClientData;
  clientNames: string;
  asOfLabel: string;
  currentYears: ProjectionYear[];
  currentSummary: RetirementSummary;
}

export default function RetirementAnalysisContent(props: Props) {
  return <RetirementAnalysisView {...props} />;
}
