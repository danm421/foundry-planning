"use client";

import type { ProjectionYear } from "@/engine";
import { StackedBarChart, type StackedBarSeries } from "./stacked-bar-chart";

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
}

export function ExpensesChart({ years }: ExpensesChartProps) {
  return <StackedBarChart years={years} series={buildExpensesDatasets()} title="Expenses by category" />;
}
