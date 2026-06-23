// src/components/portal/investment-trend-chart.tsx
"use client";
import { type ReactElement } from "react";
import { type TrendPoint } from "@/lib/portal/networth-trend";
import { TrendLineChart } from "./trend-line-chart";

export function InvestmentTrendChart({
  series, asOfDate, label = "Value",
}: { series: TrendPoint[]; asOfDate: string; label?: string }): ReactElement | null {
  return (
    <TrendLineChart
      series={series}
      asOfDate={asOfDate}
      seriesLabel={label}
      initialWindow="1M"
    />
  );
}
