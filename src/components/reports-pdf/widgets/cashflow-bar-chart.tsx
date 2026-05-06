// src/components/reports-pdf/widgets/cashflow-bar-chart.tsx
//
// Native vector PDF render for the cashflowBarChart widget. Income series
// stack positive (above zero), expenses stack negative (below zero). The
// chart renders into an `<Svg>` sized off explicit width/height props so
// callers can override for special layouts; defaults are tuned for a
// 1-up slot.
//
// Color palette + stack ordering match the on-screen Chart.js render so
// the PDF reads as the same chart, just rasterized natively. Both renders
// pull their colors from the same `lib/reports/theme.ts` source of truth.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";
import {
  AxisX,
  AxisY,
  GridLines,
  Legend,
  StackedBarSeries,
  Svg,
  fmtCompactDollar,
  makePlot,
} from "../pdf-chart-primitives";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { CashflowScopeData } from "@/lib/reports/scopes/cashflow";

const s = StyleSheet.create({
  wrap: {
    padding: 12,
    borderWidth: 1,
    borderColor: PDF_THEME.hair,
    backgroundColor: PDF_THEME.card2,
    borderRadius: PDF_THEME.radii.card,
  },
  title: { fontSize: 12, color: PDF_THEME.ink, marginBottom: 4 },
  subtitle: { fontSize: 9, color: PDF_THEME.ink3, marginBottom: 6 },
  placeholder: {
    fontSize: 10,
    color: PDF_THEME.ink3,
    textAlign: "center",
    padding: 24,
  },
});

const SERIES = [
  { key: "incomeWages",          label: "Wages",           color: PDF_THEME.chart[0], dir: "positive" as const },
  { key: "incomeSocialSecurity", label: "Social Security", color: PDF_THEME.chart[1], dir: "positive" as const },
  { key: "incomePensions",       label: "Pensions",        color: PDF_THEME.chart[2], dir: "positive" as const },
  { key: "incomeWithdrawals",    label: "Withdrawals",     color: PDF_THEME.chart[3], dir: "positive" as const },
  { key: "incomeOther",          label: "Other",           color: PDF_THEME.chart[5], dir: "positive" as const },
  { key: "expenses",             label: "Expenses",        color: PDF_THEME.crit,     dir: "negative" as const },
] satisfies readonly {
  key: keyof CashflowScopeData["years"][number];
  label: string;
  color: string;
  dir: "positive" | "negative";
}[];

export function CashflowBarChartPdfRender({
  props,
  data,
  width = 480,
  height = 220,
}: WidgetRenderProps<"cashflowBarChart"> & { width?: number; height?: number }) {
  const d = (data as { cashflow?: CashflowScopeData })?.cashflow;
  const years = d?.years ?? [];

  if (years.length === 0) {
    return (
      <View style={s.wrap}>
        <Text style={s.title}>{props.title}</Text>
        {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
        <Text style={s.placeholder}>Cashflow data not available.</Text>
      </View>
    );
  }

  // Compute Y domain: max positive stack and max negative stack.
  let posMax = 0;
  let negMax = 0;
  for (const y of years) {
    const pos =
      y.incomeWages +
      y.incomeSocialSecurity +
      y.incomePensions +
      y.incomeWithdrawals +
      y.incomeOther;
    if (pos > posMax) posMax = pos;
    if (y.expenses > negMax) negMax = y.expenses;
  }
  // Pad the domain a touch so the tallest bar isn't flush with the frame.
  const yMax = posMax * 1.05;
  const yMin = -(negMax * 1.05);

  const xs = years.map((y) => y.year);
  const xDomain: [number, number] = [xs[0] - 0.5, xs[xs.length - 1] + 0.5];

  // Reserve room at bottom for the legend.
  const legendHeight = props.showLegend ? 18 : 0;
  const plotHeight = height - legendHeight;
  const plot = makePlot({
    width,
    height: plotHeight,
    xDomain,
    yDomain: [yMin, yMax],
  });

  const datasets = SERIES.map((sd) => ({
    label: sd.label,
    color: sd.color,
    direction: sd.dir,
    values: years.map((y) => y[sd.key]),
  }));

  return (
    <View style={s.wrap}>
      <Text style={s.title}>{props.title}</Text>
      {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
      <Svg width={width} height={height}>
        {props.showGrid ? <GridLines plot={plot} /> : null}
        <StackedBarSeries plot={plot} xs={xs} datasets={datasets} />
        <AxisX plot={plot} years={xs} />
        <AxisY plot={plot} format={fmtCompactDollar} />
        {props.showLegend ? (
          <Legend
            items={SERIES.map((sd) => ({ label: sd.label, color: sd.color }))}
            x={plot.inner.x}
            y={plotHeight + legendHeight / 2}
          />
        ) : null}
      </Svg>
    </View>
  );
}
