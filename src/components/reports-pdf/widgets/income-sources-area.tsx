// src/components/reports-pdf/widgets/income-sources-area.tsx
//
// Native vector PDF render for the incomeSourcesArea widget. Stacked area
// chart of annual income mix; series filtered in/out by `props.series`.
// Color palette + stack ordering match the on-screen Chart.js render so
// the PDF reads as the same chart, just rasterized natively. Both renders
// pull their colors from the same `lib/reports/theme.ts` source of truth.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";
import {
  AreaSeries,
  AxisX,
  AxisY,
  GridLines,
  Legend,
  Svg,
  fmtCompactDollar,
  usePlot,
} from "../pdf-chart-primitives";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { CashflowScopeData } from "@/lib/reports/scopes/cashflow";
import type { IncomeSourcesSeries } from "@/lib/reports/types";

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

const SERIES_DEFS: readonly {
  key: IncomeSourcesSeries;
  label: string;
  color: string;
  read: (y: CashflowScopeData["years"][number]) => number;
}[] = [
  { key: "wages",          label: "Wages",           color: PDF_THEME.chart[0], read: (y) => y.incomeWages },
  { key: "socialSecurity", label: "Social Security", color: PDF_THEME.chart[1], read: (y) => y.incomeSocialSecurity },
  { key: "pensions",       label: "Pensions",        color: PDF_THEME.chart[2], read: (y) => y.incomePensions },
  { key: "withdrawals",    label: "Withdrawals",     color: PDF_THEME.chart[3], read: (y) => y.incomeWithdrawals },
  { key: "other",          label: "Other",           color: PDF_THEME.chart[5], read: (y) => y.incomeOther },
];

export function IncomeSourcesAreaPdfRender({
  props,
  data,
  width = 480,
  height = 220,
}: WidgetRenderProps<"incomeSourcesArea"> & { width?: number; height?: number }) {
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

  const active = SERIES_DEFS.filter((sd) => props.series.includes(sd.key));

  // Stacked tops per series — each series' top edge = sum of selected
  // series up through and including itself. The lower edge for series N
  // is the top edge of series N-1 (or the zero baseline for series 0).
  const xs = years.map((y) => y.year);
  let posMax = 0;
  const tops = active.map((sd, idx) => {
    return years.map((y, i) => {
      let cum = 0;
      for (let j = 0; j <= idx; j++) cum += active[j].read(y);
      if (idx === active.length - 1 && cum > posMax) posMax = cum;
      return { x: y.year, value: cum, _i: i };
    });
  });
  const yMax = posMax * 1.05 || 1;

  const xDomain: [number, number] = [xs[0], xs[xs.length - 1]];

  const legendHeight = 18;
  const plotHeight = height - legendHeight;
  const plot = usePlot({
    width,
    height: plotHeight,
    xDomain,
    yDomain: [0, yMax],
  });

  return (
    <View style={s.wrap}>
      <Text style={s.title}>{props.title}</Text>
      {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
      <Svg width={width} height={height}>
        <GridLines plot={plot} />
        {tops.map((top, idx) => (
          <AreaSeries
            key={active[idx].key}
            plot={plot}
            points={top.map(({ x, value }) => ({ x, value }))}
            lowerPoints={
              idx === 0
                ? undefined
                : tops[idx - 1].map(({ x, value }) => ({ x, value }))
            }
            color={active[idx].color}
            fillOpacity={0.55}
            strokeColor={active[idx].color}
            strokeWidth={1}
          />
        ))}
        <AxisX plot={plot} years={xs} />
        <AxisY plot={plot} format={fmtCompactDollar} />
        <Legend
          items={active.map((sd) => ({ label: sd.label, color: sd.color }))}
          x={plot.inner.x}
          y={plotHeight + legendHeight / 2}
        />
      </Svg>
    </View>
  );
}
