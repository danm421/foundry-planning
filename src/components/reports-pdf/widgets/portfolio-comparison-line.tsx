// src/components/reports-pdf/widgets/portfolio-comparison-line.tsx
//
// Native vector PDF render for the portfolioComparisonLine widget. Two
// lines on the same year axis: "Current" (slate gray, dashed) and
// "Proposed" (accent gold, solid). End-point value labels per side give
// the reader a dollar anchor on each line without scanning ticks.
//
// The widget pulls `data.comparison` (a `ComparisonScopeData`) which the
// data-loader stamps onto each comparison-aware widget id when the report
// has a `comparisonBinding`. Falls through to a placeholder card otherwise.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";
import {
  AxisX,
  AxisY,
  GridLines,
  Legend,
  LineSeries,
  Svg,
  ValueLabel,
  fmtCompactDollar,
  usePlot,
} from "../pdf-chart-primitives";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { ComparisonScopeData } from "@/lib/reports/scopes/comparison";

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

const CURRENT_COLOR = PDF_THEME.ink2;
const PROPOSED_COLOR = PDF_THEME.accent;

type CompPayload = { comparison?: ComparisonScopeData } | null | undefined;

export function PortfolioComparisonLinePdfRender({
  props,
  data,
  width = 480,
  height = 220,
}: WidgetRenderProps<"portfolioComparisonLine"> & {
  width?: number;
  height?: number;
}) {
  const comparison = (data as CompPayload)?.comparison;

  if (!comparison) {
    return (
      <View style={s.wrap}>
        <Text style={s.title}>{props.title}</Text>
        {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
        <Text style={s.placeholder}>
          Bind two scenarios to use this widget.
        </Text>
      </View>
    );
  }

  const curPoints = comparison.current.balance.years.map((y) => ({
    x: y.year,
    value: y.netWorth,
  }));
  const propPoints = comparison.proposed.balance.years.map((y) => ({
    x: y.year,
    value: y.netWorth,
  }));

  if (curPoints.length === 0 && propPoints.length === 0) {
    return (
      <View style={s.wrap}>
        <Text style={s.title}>{props.title}</Text>
        {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
        <Text style={s.placeholder}>Portfolio data not available.</Text>
      </View>
    );
  }

  const allXs = [...curPoints.map((p) => p.x), ...propPoints.map((p) => p.x)];
  const allVs = [...curPoints.map((p) => p.value), ...propPoints.map((p) => p.value)];
  const minV = Math.min(0, ...allVs);
  const maxV = Math.max(...allVs);
  const yPad = (maxV - minV) * 0.08 || 1;

  const xs = Array.from(new Set(allXs)).sort((a, b) => a - b);
  const xDomain: [number, number] = [xs[0], xs[xs.length - 1]];
  const yDomain: [number, number] = [minV, maxV + yPad];

  // Reserve room at the bottom for the legend.
  const legendHeight = 18;
  const plotHeight = height - legendHeight;
  const plot = usePlot({
    width,
    height: plotHeight,
    xDomain,
    yDomain,
  });

  const lastCur = curPoints[curPoints.length - 1];
  const lastProp = propPoints[propPoints.length - 1];

  return (
    <View style={s.wrap}>
      <Text style={s.title}>{props.title}</Text>
      {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
      <Svg width={width} height={height}>
        {props.showGrid ? <GridLines plot={plot} /> : null}
        <LineSeries
          plot={plot}
          points={curPoints}
          color={CURRENT_COLOR}
          strokeWidth={1.2}
          strokeDasharray="3 2"
        />
        <LineSeries
          plot={plot}
          points={propPoints}
          color={PROPOSED_COLOR}
          strokeWidth={1.8}
        />
        <AxisX plot={plot} years={xs} />
        <AxisY plot={plot} format={fmtCompactDollar} />
        {lastCur ? (
          <ValueLabel
            x={plot.xScale(lastCur.x)}
            y={plot.yScale(lastCur.value) - 6}
            text={fmtCompactDollar(lastCur.value)}
            color={CURRENT_COLOR}
            textAnchor="end"
          />
        ) : null}
        {lastProp ? (
          <ValueLabel
            x={plot.xScale(lastProp.x)}
            y={plot.yScale(lastProp.value) - 6}
            text={fmtCompactDollar(lastProp.value)}
            color={PROPOSED_COLOR}
            textAnchor="end"
          />
        ) : null}
        <Legend
          items={[
            { label: "Current", color: CURRENT_COLOR },
            { label: "Proposed", color: PROPOSED_COLOR },
          ]}
          x={plot.inner.x}
          y={plotHeight + legendHeight / 2}
        />
      </Svg>
    </View>
  );
}
