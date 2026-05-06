// src/components/reports-pdf/widgets/tax-bracket-chart.tsx
//
// Native vector PDF render for the taxBracketChart widget. Stacked SVG
// bars per year showing income filling 2026 single-filer federal tax
// brackets. Same bucket math as the screen render — both consume
// `splitIncomeIntoBrackets` from the shared module.
//
// Layout: title block on top, plot area middle, legend at bottom (one
// swatch per bracket rate). The legend reflows to a second line if the
// plot is narrow.
//
// V1 limitations are documented in the registration glue and the shared
// math module — single-filer brackets only, `showRothBands` is a no-op
// pending Roth-conversion data plumbing.

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
  usePlot,
} from "../pdf-chart-primitives";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import {
  totalIncome,
  type CashflowScopeData,
} from "@/lib/reports/scopes/cashflow";
import {
  BRACKETS_2026_SINGLE,
  BRACKET_COLORS,
  splitIncomeIntoBrackets,
} from "@/lib/reports/widgets/tax-bracket-chart.shared";

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

export function TaxBracketChartPdfRender({
  props,
  data,
  width = 480,
  height = 240,
}: WidgetRenderProps<"taxBracketChart"> & {
  width?: number;
  height?: number;
}) {
  const d = (data as { cashflow?: CashflowScopeData })?.cashflow;
  const years = d?.years ?? [];

  // Compute per-year per-bracket fills via the shared math, then stack.
  // posMax = largest single-year stacked total = highest bracket-clipped income.
  const xs = years.map((y) => y.year);
  let posMax = 0;
  const perBracketSeries = BRACKETS_2026_SINGLE.map(() => [] as number[]);
  for (const y of years) {
    const slices = splitIncomeIntoBrackets(totalIncome(y));
    let yearStack = 0;
    slices.forEach((slc, i) => {
      perBracketSeries[i].push(slc.amount);
      yearStack += slc.amount;
    });
    if (yearStack > posMax) posMax = yearStack;
  }
  const yMax = posMax > 0 ? posMax * 1.05 : 1;

  // Reserve room at the bottom for the legend (two-row safe — 7 entries
  // can wrap on narrow widths). Domain endpoints fall back to 0/1 when
  // there are no years so `usePlot` (a pure helper, not a real hook
  // despite the name) can be called unconditionally — keeps the
  // react-hooks/rules-of-hooks linter happy.
  const legendHeight = 28;
  const plotHeight = height - legendHeight;
  const xDomain: [number, number] =
    xs.length > 0 ? [xs[0] - 0.5, xs[xs.length - 1] + 0.5] : [0, 1];
  const plot = usePlot({
    width,
    height: plotHeight,
    xDomain,
    yDomain: [0, yMax],
  });

  if (years.length === 0) {
    return (
      <View style={s.wrap}>
        <Text style={s.title}>{props.title}</Text>
        {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
        <Text style={s.placeholder}>Income data not available.</Text>
      </View>
    );
  }

  const datasets = BRACKETS_2026_SINGLE.map(([, , rate], i) => ({
    label: `${rate}%`,
    color: BRACKET_COLORS[i],
    direction: "positive" as const,
    values: perBracketSeries[i],
  }));

  return (
    <View style={s.wrap}>
      <Text style={s.title}>{props.title}</Text>
      {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
      <Svg width={width} height={height}>
        <GridLines plot={plot} />
        <StackedBarSeries plot={plot} xs={xs} datasets={datasets} />
        <AxisX plot={plot} years={xs} />
        <AxisY plot={plot} format={fmtCompactDollar} />
        <Legend
          items={datasets.map((d) => ({ label: d.label, color: d.color }))}
          x={plot.inner.x}
          y={plotHeight + legendHeight / 2}
        />
      </Svg>
    </View>
  );
}
