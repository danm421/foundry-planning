"use client";

import { useCallback, useRef } from "react";
import type { ProjectionYear } from "@/engine";
import { StackedBarChart, type StackedBarSeries } from "./stacked-bar-chart";
import { useChartCapture } from "@/lib/report-artifacts/chart-capture";

export function buildIncomeDatasets(): StackedBarSeries[] {
  return [
    { label: "Salaries",       colorKey: "green",  valueFor: (y) => y.income.salaries },
    { label: "Social Security",colorKey: "blue",   valueFor: (y) => y.income.socialSecurity },
    { label: "Business",       colorKey: "teal",   valueFor: (y) => y.income.business },
    { label: "Trust",          colorKey: "purple", valueFor: (y) => y.income.trust },
    { label: "Deferred",       colorKey: "orange", valueFor: (y) => y.income.deferred },
    { label: "Capital Gains",  colorKey: "yellow", valueFor: (y) => y.income.capitalGains },
    { label: "Other",          colorKey: "grey",   valueFor: (y) => y.income.other },
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
