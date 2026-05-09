"use client";

import { useCallback, useRef } from "react";
import type { ProjectionYear } from "@/engine";
import { StackedBarChart, type StackedBarSeries } from "./stacked-bar-chart";
import { useChartCapture } from "@/lib/report-artifacts/chart-capture";

export function buildExpensesDatasets(): StackedBarSeries[] {
  return [
    { label: "Living", color: "#16a34a", valueFor: (y) => y.expenses.living },
    { label: "Real Estate", color: "#0891b2", valueFor: (y) => y.expenses.realEstate },
    { label: "Insurance", color: "#7c3aed", valueFor: (y) => y.expenses.insurance },
    { label: "Taxes", color: "#ea580c", valueFor: (y) => y.expenses.taxes },
    { label: "Debt service", color: "#ef4444", valueFor: (y) => y.expenses.liabilities },
    { label: "Other", color: "#99f6e4", valueFor: (y) => y.expenses.other },
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
