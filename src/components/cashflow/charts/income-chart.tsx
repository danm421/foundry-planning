"use client";

import { useCallback, useRef } from "react";
import type { ProjectionYear } from "@/engine";
import { StackedBarChart, type StackedBarSeries } from "./stacked-bar-chart";
import { useChartCapture } from "@/lib/report-artifacts/chart-capture";

export function buildIncomeDatasets(): StackedBarSeries[] {
  return [
    { label: "Salaries",       color: "var(--color-data-emerald)", valueFor: (y) => y.income.salaries },
    { label: "Social Security",color: "var(--color-data-indigo)",  valueFor: (y) => y.income.socialSecurity },
    { label: "Business",       color: "var(--color-data-slate)",   valueFor: (y) => y.income.business },
    { label: "Trust",          color: "var(--color-data-violet)",  valueFor: (y) => y.income.trust },
    { label: "Deferred",       color: "var(--color-data-terra)",   valueFor: (y) => y.income.deferred },
    { label: "Capital Gains",  color: "var(--color-data-wheat)",   valueFor: (y) => y.income.capitalGains },
    { label: "Other",          color: "var(--color-data-sage)",    valueFor: (y) => y.income.other },
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
