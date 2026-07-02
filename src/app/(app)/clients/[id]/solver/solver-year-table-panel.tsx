"use client";

import type { ClientData, ProjectionYear } from "@/engine/types";
import { AnalysisYearTable } from "@/components/scenario/year-table";
import { retirementYearColumns } from "@/components/scenario/retirement-year-columns";

interface Props {
  /** The full working-plan projection — all years, no retirement slice. */
  years: ProjectionYear[];
  hasSpouse: boolean;
  /** Working tree — resolves account/income/expense names for cell drill-downs. */
  clientData: ClientData;
}

export function SolverYearTablePanel({ years, hasSpouse, clientData }: Props) {
  return (
    // overflow-hidden (not -auto) keeps the rounded border from clipping while
    // leaving the inner table div as the sole scroll container, so its sticky
    // header locks on scroll.
    <div className="mt-3 overflow-hidden rounded-md border border-hair-2">
      <AnalysisYearTable
        rows={years}
        columns={retirementYearColumns(hasSpouse, clientData)}
        caption="Year-by-year detail (all plan years)"
        maxHeight={360}
      />
    </div>
  );
}
