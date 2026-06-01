"use client";

import type { ProjectionYear } from "@/engine/types";
import { AnalysisYearTable } from "@/components/analysis/analysis-year-table";
import { retirementYearColumns } from "@/components/analysis/retirement/retirement-year-columns";

interface Props {
  /** The full working-plan projection — all years, no retirement slice. */
  years: ProjectionYear[];
  hasSpouse: boolean;
}

export function SolverYearTablePanel({ years, hasSpouse }: Props) {
  return (
    // overflow-hidden (not -auto) keeps the rounded border from clipping while
    // leaving the inner table div as the sole scroll container, so its sticky
    // header locks on scroll.
    <div className="mt-3 overflow-hidden rounded-md border border-hair-2">
      <AnalysisYearTable
        rows={years}
        columns={retirementYearColumns(hasSpouse)}
        caption="Year-by-year detail (all plan years)"
        maxHeight={360}
      />
    </div>
  );
}
