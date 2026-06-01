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
    <div className="mt-3 max-h-[360px] overflow-auto rounded-md border border-hair-2">
      <AnalysisYearTable
        rows={years}
        columns={retirementYearColumns(hasSpouse)}
        caption="Year-by-year detail (all plan years)"
      />
    </div>
  );
}
