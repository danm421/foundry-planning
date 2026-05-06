// src/components/reports-pdf/widgets/net-worth-line.tsx
//
// Native vector PDF render for the netWorthLine widget. Renders an area
// fill under the trajectory plus a stroked line on top, with end-point
// value labels (start year + end year) so readers can ground the line
// in dollars without studying axis ticks.
//
// `compareScenarioId` is reserved for the scenario-comparison feature; in
// v1 it's a no-op (a second dashed line is added once the comparison
// scope lands — see future-work/reports.md).

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";
import {
  AreaSeries,
  AxisX,
  AxisY,
  GridLines,
  LineSeries,
  Svg,
  ValueLabel,
  fmtCompactDollar,
  usePlot,
} from "../pdf-chart-primitives";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { BalanceScopeData } from "@/lib/reports/scopes/balance";

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

export function NetWorthLinePdfRender({
  props,
  data,
  width = 480,
  height = 220,
}: WidgetRenderProps<"netWorthLine"> & { width?: number; height?: number }) {
  const d = (data as { balance?: BalanceScopeData })?.balance;
  const years = d?.years ?? [];

  if (years.length === 0) {
    return (
      <View style={s.wrap}>
        <Text style={s.title}>{props.title}</Text>
        {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
        <Text style={s.placeholder}>Net worth data not available.</Text>
      </View>
    );
  }

  const points = years.map((y) => ({ x: y.year, value: y.netWorth }));
  const minV = Math.min(0, ...points.map((p) => p.value));
  const maxV = Math.max(...points.map((p) => p.value));
  const yPad = (maxV - minV) * 0.08 || 1;

  const xs = points.map((p) => p.x);
  const xDomain: [number, number] = [xs[0], xs[xs.length - 1]];
  const yDomain: [number, number] = [minV, maxV + yPad];

  const plot = usePlot({ width, height, xDomain, yDomain });

  const accent = PDF_THEME.chart[2]; // steel — net-worth has historically read as steel/blue

  return (
    <View style={s.wrap}>
      <Text style={s.title}>{props.title}</Text>
      {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
      <Svg width={width} height={height}>
        {props.showGrid ? <GridLines plot={plot} /> : null}
        <AreaSeries
          plot={plot}
          points={points}
          color={accent}
          fillOpacity={0.18}
          baseValue={Math.min(0, minV)}
        />
        <LineSeries plot={plot} points={points} color={accent} strokeWidth={1.6} />
        <AxisX plot={plot} years={xs} />
        <AxisY plot={plot} format={fmtCompactDollar} />
        {/* Endpoint value labels — anchor end label to the right of the
            last point so it doesn't get clipped by the frame. */}
        <ValueLabel
          x={plot.xScale(xs[0])}
          y={plot.yScale(points[0].value) - 6}
          text={fmtCompactDollar(points[0].value)}
          color={PDF_THEME.ink}
          textAnchor="start"
        />
        <ValueLabel
          x={plot.xScale(xs[xs.length - 1])}
          y={plot.yScale(points[points.length - 1].value) - 6}
          text={fmtCompactDollar(points[points.length - 1].value)}
          color={PDF_THEME.ink}
          textAnchor="end"
        />
      </Svg>
    </View>
  );
}
