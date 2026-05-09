"use client";

import { useCallback, useRef } from "react";
import type { ProjectionYear } from "@/engine";
import { StackedBarChart, type StackedBarSeries } from "./stacked-bar-chart";
import { useChartCapture } from "@/lib/report-artifacts/chart-capture";

export function buildIncomeDatasets(): StackedBarSeries[] {
  return [
    { label: "Salaries", color: "#16a34a", valueFor: (y) => y.income.salaries },
    { label: "Social Security", color: "#2563eb", valueFor: (y) => y.income.socialSecurity },
    { label: "Business", color: "#0891b2", valueFor: (y) => y.income.business },
    { label: "Trust", color: "#7c3aed", valueFor: (y) => y.income.trust },
    { label: "Deferred", color: "#ea580c", valueFor: (y) => y.income.deferred },
    { label: "Capital Gains", color: "#facc15", valueFor: (y) => y.income.capitalGains },
    { label: "Other", color: "#99f6e4", valueFor: (y) => y.income.other },
  ];
}

interface IncomeChartProps {
  years: ProjectionYear[];
  dataVersion: string;
}

export function IncomeChart({ years, dataVersion }: IncomeChartProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  useChartCapture(
    { reportId: "cashflow", chartId: "income", dataVersion },
    useCallback(() => ref.current?.querySelector("canvas") ?? null, []),
  );
  return (
    <div ref={ref}>
      <StackedBarChart years={years} series={buildIncomeDatasets()} title="Income by source" />
    </div>
  );
}
