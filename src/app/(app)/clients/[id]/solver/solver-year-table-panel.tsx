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
    // No inner scroll box: the table renders at full height and scrolls with the
    // report column (which scrolls "as one document"), matching the Taxes tab.
    // overflow-hidden clips the table to the rounded corners; the inner table
    // keeps its own overflow-x-auto for horizontal scroll on narrow viewports.
    <div className="mt-3 overflow-hidden rounded-md border border-hair-2">
      <AnalysisYearTable
        rows={years}
        columns={retirementYearColumns(hasSpouse, clientData)}
        caption="Year-by-year detail (all plan years)"
      />
    </div>
  );
}
