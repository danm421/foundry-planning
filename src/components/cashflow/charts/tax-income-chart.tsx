"use client";

import type { ProjectionYear } from "@/engine";
import { StackedBarChart, type StackedBarSeries } from "./stacked-bar-chart";

export function buildTaxIncomeDatasets(): StackedBarSeries[] {
  return [
    { label: "Earned",            colorKey: "green",  valueFor: (y) => y.taxDetail?.earnedIncome ?? 0 },
    { label: "Ordinary",          colorKey: "blue",   valueFor: (y) => y.taxDetail?.ordinaryIncome ?? 0 },
    { label: "Qualified Dividends",colorKey: "grey",  valueFor: (y) => y.taxDetail?.dividends ?? 0 },
    { label: "LT Capital Gains",  colorKey: "yellow", valueFor: (y) => y.taxDetail?.capitalGains ?? 0 },
    { label: "ST Capital Gains",  colorKey: "orange", valueFor: (y) => y.taxDetail?.stCapitalGains ?? 0 },
    { label: "QBI",               colorKey: "purple", valueFor: (y) => y.taxDetail?.qbi ?? 0 },
    { label: "Tax-Exempt",        colorKey: "teal",   valueFor: (y) => y.taxDetail?.taxExempt ?? 0 },
  ];
}

interface TaxIncomeChartProps {
  years: ProjectionYear[];
}

export function TaxIncomeChart({ years }: TaxIncomeChartProps) {
  return <StackedBarChart years={years} series={buildTaxIncomeDatasets()} title="Taxable income breakdown" />;
}
