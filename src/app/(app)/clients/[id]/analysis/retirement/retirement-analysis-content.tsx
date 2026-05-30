"use client";

import type { ProjectionYear } from "@/engine/types";
import type { RetirementSummary } from "@/lib/analysis/derive-retirement-summary";

interface Props {
  clientId: string;
  source: string;
  clientNames: string;
  asOfLabel: string;
  currentYears: ProjectionYear[];
  currentSummary: RetirementSummary;
}

export default function RetirementAnalysisContent(props: Props) {
  return (
    <div className="p-[var(--pad-card)] text-ink">
      <h1 className="text-2xl">Retirement Analysis — {props.clientNames}</h1>
      <p className="text-ink-3">As of {props.asOfLabel}</p>
      <p className="tabular">
        Assets remaining: {props.currentSummary.assetsRemaining}
      </p>
      <p>
        Age assets last until:{" "}
        {props.currentSummary.ageAssetsLastUntil
          ? `${props.currentSummary.ageAssetsLastUntil.client}/${props.currentSummary.ageAssetsLastUntil.spouse ?? "—"}`
          : "fully funded"}
      </p>
      <p>{props.currentYears.length} projected years</p>
    </div>
  );
}
