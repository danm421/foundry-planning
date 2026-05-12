"use client";

import { useMemo } from "react";
import { buildYearlyEstateReport } from "@/lib/estate/yearly-estate-report";
import { YearlyEstateWhereChart } from "@/components/yearly-estate-where-chart";
import { YearlyEstateTable } from "@/components/yearly-estate-table";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import { seriesColor } from "@/lib/comparison/series-palette";
import { deriveOwnerNames, deriveOwnerDobs } from "@/lib/comparison/owner-info";

function buildReport(plan: ComparisonPlan) {
  return buildYearlyEstateReport({
    projection: plan.result,
    clientData: plan.tree,
    ordering: "primaryFirst",
    ownerNames: deriveOwnerNames(plan.tree),
    ownerDobs: deriveOwnerDobs(plan.tree),
  });
}

export function EstateTransfersYearlyChart({ plans }: { plans: ComparisonPlan[] }) {
  const colsClass =
    plans.length === 1
      ? "grid-cols-1"
      : plans.length === 2
        ? "grid-cols-1 lg:grid-cols-2"
        : "grid-cols-1 md:grid-cols-3";
  return (
    <div className={`grid gap-4 ${colsClass}`}>
      {plans.map((plan, i) => {
        const color = seriesColor(i) ?? "#cbd5e1";
        const report = buildReport(plan);
        return (
          <div
            key={plan.id}
            className="rounded-lg border border-slate-800 bg-slate-900/40 p-4"
          >
            <div className="mb-2 flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: color }}
                aria-hidden
              />
              <span className="text-xs uppercase tracking-wide text-slate-400">
                {plan.label}
              </span>
            </div>
            <YearlyEstateWhereChart rows={report.rows} />
          </div>
        );
      })}
    </div>
  );
}

export function EstateTransfersYearlyTable({ plans }: { plans: ComparisonPlan[] }) {
  return (
    <div className="flex flex-col gap-6">
      {plans.map((plan) => {
        const report = buildReport(plan);
        const ownerNames = deriveOwnerNames(plan.tree);
        return (
          <div key={plan.id}>
            <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">
              {plan.label}
            </div>
            <YearlyEstateTable
              rows={report.rows}
              totals={report.totals}
              ownerNames={ownerNames}
              ordering={report.ordering}
            />
          </div>
        );
      })}
    </div>
  );
}

export function EstateTransfersYearlyComparisonSection({
  plans,
  mode,
}: {
  plans: ComparisonPlan[];
  mode: "chart" | "chart+table" | "table";
}) {
  const chart = useMemo(() => <EstateTransfersYearlyChart plans={plans} />, [plans]);
  const table = useMemo(() => <EstateTransfersYearlyTable plans={plans} />, [plans]);
  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">
        Estate Transfers — Year by Year
      </h2>
      {mode === "chart" ? (
        chart
      ) : mode === "table" ? (
        table
      ) : (
        <div className="flex flex-col gap-3">
          {chart}
          {table}
        </div>
      )}
    </section>
  );
}
