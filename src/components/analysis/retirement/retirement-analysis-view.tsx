"use client";

// Retirement Analysis orchestrator. Composes the full Summary view: headline,
// hero chart, KPI row, the "What are your Options?" solver grid + live Explore
// column, and the year-by-year table. The Explore column's recompute result
// (when the advisor edits) becomes the effective projection driving every
// other panel; otherwise the server-computed current projection is shown.

import { useCallback, useMemo, useState } from "react";
import type { ClientData, ProjectionYear } from "@/engine/types";
import type { RetirementSummary } from "@/lib/analysis/derive-retirement-summary";
import type { SolverSource } from "@/lib/solver/types";
import { AnalysisShell } from "@/components/analysis/analysis-shell";
import { AnalysisHeadline } from "@/components/analysis/analysis-headline";
import { AnalysisKpiRow } from "@/components/analysis/analysis-kpi-row";
import { AnalysisYearTable } from "@/components/analysis/analysis-year-table";
import { AnalysisOptionsGrid } from "@/components/analysis/analysis-options-grid";
import { RetirementHeroChart } from "./retirement-hero-chart";
import { buildSummaryHeadline, buildKpis } from "./retirement-headline";
import { retirementYearColumns } from "./retirement-year-columns";
import {
  buildExploreRows,
  defaultSavingsAccountId,
  savingsColumnAccountId,
} from "./retirement-options-config";

const STEPS = [
  "Family Info",
  "Cost of Retirement",
  "Savings & Contributions",
  "Retirement Income",
  "Summary",
];

interface Props {
  clientId: string;
  source: SolverSource;
  /** Effective tree (base or scenario) — drives the Explore rows + solve target. */
  tree: ClientData;
  clientNames: string;
  asOfLabel: string;
  currentYears: ProjectionYear[];
  currentSummary: RetirementSummary;
}

export function RetirementAnalysisView({
  clientId,
  source,
  tree,
  clientNames,
  asOfLabel,
  currentYears,
  currentSummary,
}: Props) {
  const [view, setView] = useState<"summary" | "probability">("summary");
  const [explored, setExplored] = useState<{
    years: ProjectionYear[];
    summary: RetirementSummary;
  } | null>(null);

  const effectiveYears = explored ? explored.years : currentYears;
  const effectiveSummary = explored ? explored.summary : currentSummary;

  const hasSpouse = currentYears[0]?.ages.spouse != null;

  const rows = useMemo(() => buildExploreRows(tree), [tree]);
  // The min-savings column targets the SAME account its highlighted Pre-Tax
  // Contributions row edits (one source of truth). When that row is absent the
  // body still needs a valid account so max-spending / earliest-retirement can
  // solve, so fall back to the largest retirement account; the grid renders
  // min-savings as "Not applicable" in that case (no pre-tax row to show on).
  const savingsAccountId = useMemo(
    () => savingsColumnAccountId(rows) ?? defaultSavingsAccountId(tree),
    [rows, tree],
  );

  const onExploreResult = useCallback(
    (result: { years: ProjectionYear[]; summary: RetirementSummary } | null) => {
      setExplored(result);
    },
    [],
  );

  return (
    <AnalysisShell
      title="Retirement Analysis"
      asOfLabel={asOfLabel}
      clientNames={clientNames}
      steps={STEPS}
      view={view}
      onViewChange={setView}
    >
      {view === "summary" ? (
        <div className="flex flex-col gap-[var(--gap-grid)] p-[var(--pad-card)]">
          <AnalysisHeadline segments={buildSummaryHeadline(effectiveSummary)} />
          <RetirementHeroChart years={effectiveYears} />
          <AnalysisKpiRow items={buildKpis(effectiveSummary)} />
          <AnalysisOptionsGrid
            clientId={clientId}
            source={source}
            rows={rows}
            savingsAccountId={savingsAccountId}
            onExploreResult={onExploreResult}
          />
          <AnalysisYearTable
            rows={effectiveYears}
            columns={retirementYearColumns(hasSpouse)}
            caption="Year-by-year breakdown"
          />
        </div>
      ) : (
        <div className="flex min-h-[40vh] items-center justify-center p-[var(--pad-card)] text-center">
          <p className="text-[15px] text-ink-3">Probability view coming soon</p>
        </div>
      )}
    </AnalysisShell>
  );
}
