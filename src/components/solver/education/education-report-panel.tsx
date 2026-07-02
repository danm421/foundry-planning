"use client";

import { useMemo } from "react";
import type { ProjectionYear } from "@/engine/types";
import { buildEducationReport } from "@/lib/reports/education-report-data";
import { EducationChart } from "@/components/charts/education-chart";
import { AnalysisYearTable } from "@/components/scenario/year-table";
import { educationYearColumns } from "@/components/scenario/education-year-columns";
import { formatCurrency } from "@/components/monte-carlo/lib/format";

interface Props {
  years: ProjectionYear[];
  expenses: { id: string; name: string }[];
}

export function EducationReportPanel({ years, expenses }: Props) {
  const reports = useMemo(() => buildEducationReport(years, expenses), [years, expenses]);
  const columns = useMemo(() => educationYearColumns(), []);

  if (reports.length === 0) {
    return (
      <div className="p-6 text-sm text-ink-3">
        No education goals. Add an Education expense with dedicated funding on
        the Income &amp; Expenses page.
      </div>
    );
  }

  return (
    <div className="space-y-8 p-1">
      {reports.map((r) => (
        <section key={r.goalId} className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-lg font-semibold text-ink">{r.name}</h3>
            <div className="flex gap-6 text-sm">
              <div>
                <span className="text-ink-3">Dedicated Funds Used</span>{" "}
                <span className="font-semibold text-ink">{formatCurrency(r.dedicatedFundsUsed)}</span>
              </div>
              <div>
                <span className="text-ink-3">Shortfall</span>{" "}
                <span className="font-semibold text-crit">{formatCurrency(r.totalShortfall)}</span>
              </div>
            </div>
          </div>
          <div className="h-64">
            <EducationChart chart={r.chart} />
          </div>
          <div className="overflow-hidden rounded-md border border-hair-2">
            <AnalysisYearTable rows={r.rows} columns={columns} caption={`${r.name} — year-by-year`} maxHeight={360} />
          </div>
        </section>
      ))}
    </div>
  );
}
