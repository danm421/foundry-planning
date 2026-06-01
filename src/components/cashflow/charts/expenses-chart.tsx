"use client";

import { useCallback, useRef } from "react";
import type { ProjectionYear } from "@/engine";
import { StackedBarChart, type StackedBarSeries } from "./stacked-bar-chart";
import { useChartCapture } from "@/lib/report-artifacts/chart-capture";

// Colors are omitted so the chart draws from the theme-aware brand palette
// (adjacency order) and recolors on theme toggle — see StackedBarChart.
export function buildExpensesDatasets(): StackedBarSeries[] {
  return [
    { label: "Living", valueFor: (y) => y.expenses.living },
    { label: "Surplus spent", valueFor: (y) => y.expenses.discretionary },
    { label: "Real Estate", valueFor: (y) => y.expenses.realEstate },
    { label: "Insurance", valueFor: (y) => y.expenses.insurance },
    { label: "Taxes", valueFor: (y) => y.expenses.taxes },
    { label: "Debt service", valueFor: (y) => y.expenses.liabilities },
    { label: "Other", valueFor: (y) => y.expenses.other },
  ];
}

interface ExpensesChartProps {
  years: ProjectionYear[];
  dataVersion: string;
}

export function ExpensesChart({ years, dataVersion }: ExpensesChartProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useChartCapture(
    { reportId: "cashflow", chartId: "expenses", dataVersion },
    useCallback(() => ref.current?.querySelector("canvas") ?? null, []),
  );
  return (
    <div ref={ref}>
      <StackedBarChart years={years} series={buildExpensesDatasets()} title="Expenses by category" />
    </div>
  );
}
