// src/components/reports-pdf/widgets/monte-carlo-fan.tsx
//
// Native vector PDF render for the monteCarloFan widget. Stacks
// percentile-band areas around the median (5/25/50/75/95), with a darker
// median line on top. Headline ("X% chance of success") is rendered
// above the chart when `props.showHeadline` is set.
//
// v1 reality: the `monteCarlo` scope is a stub returning
// `{ successProbability: null, bands: [] }`. In that state we render the
// same placeholder as the screen view — the chart slot stays empty until
// the engine wiring lands.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";
import {
  AreaSeries,
  AxisX,
  AxisY,
  GridLines,
  LineSeries,
  Svg,
  fmtCompactDollar,
  usePlot,
} from "../pdf-chart-primitives";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { MonteCarloScopeData } from "@/lib/reports/scopes/monteCarlo";

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
  headline: { fontSize: 18, color: PDF_THEME.ink, marginBottom: 8 },
  placeholder: {
    fontSize: 10,
    color: PDF_THEME.ink3,
    textAlign: "center",
    padding: 24,
  },
});

export function MonteCarloFanPdfRender({
  props,
  data,
  width = 480,
  height = 220,
}: WidgetRenderProps<"monteCarloFan"> & { width?: number; height?: number }) {
  const d = (data as { monteCarlo?: MonteCarloScopeData })?.monteCarlo;
  const headline =
    d?.successProbability == null
      ? "—"
      : `${(d.successProbability * 100).toFixed(0)}% chance of success`;
  const bands = (d?.bands ?? []).filter((b) => props.bands.includes(50)
    ? true
    : props.bands.length > 0);
  // Above filter is permissive — the inspector selects which percentile
  // bands to render and we honour that below; the early filter just
  // guards the empty-state branch.

  if (bands.length === 0 || (d?.bands?.length ?? 0) === 0) {
    return (
      <View style={s.wrap}>
        <Text style={s.title}>{props.title}</Text>
        {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
        {props.showHeadline ? <Text style={s.headline}>{headline}</Text> : null}
        <Text style={s.placeholder}>Monte Carlo trials not yet available.</Text>
      </View>
    );
  }

  const allBands = d?.bands ?? [];
  const xs = allBands.map((b) => b.year);
  const xDomain: [number, number] = [xs[0], xs[xs.length - 1]];
  // Y domain: pad off the most-extreme percentile in either direction.
  const allValues = allBands.flatMap((b) => [b.p5, b.p25, b.p50, b.p75, b.p95]);
  const yMin = Math.min(...allValues);
  const yMax = Math.max(...allValues);
  const yPad = (yMax - yMin) * 0.08 || 1;
  const yDomain: [number, number] = [Math.min(0, yMin - yPad), yMax + yPad];

  const headlineHeight = props.showHeadline ? 24 : 0;
  const chartHeight = height - headlineHeight;
  const plot = usePlot({ width, height: chartHeight, xDomain, yDomain });

  const enabled = new Set(props.bands);
  const accent = PDF_THEME.chart[2]; // steel band tone

  // Outer band: fill between p5 and p95, lighter alpha.
  const outerArea =
    enabled.has(5) && enabled.has(95)
      ? {
          upper: allBands.map((b) => ({ x: b.year, value: b.p95 })),
          lower: allBands.map((b) => ({ x: b.year, value: b.p5 })),
        }
      : null;
  const innerArea =
    enabled.has(25) && enabled.has(75)
      ? {
          upper: allBands.map((b) => ({ x: b.year, value: b.p75 })),
          lower: allBands.map((b) => ({ x: b.year, value: b.p25 })),
        }
      : null;
  const median = enabled.has(50)
    ? allBands.map((b) => ({ x: b.year, value: b.p50 }))
    : null;

  return (
    <View style={s.wrap}>
      <Text style={s.title}>{props.title}</Text>
      {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
      {props.showHeadline ? <Text style={s.headline}>{headline}</Text> : null}
      <Svg width={width} height={chartHeight}>
        <GridLines plot={plot} />
        {outerArea ? (
          <AreaSeries
            plot={plot}
            points={outerArea.upper}
            lowerPoints={outerArea.lower}
            color={accent}
            fillOpacity={0.18}
          />
        ) : null}
        {innerArea ? (
          <AreaSeries
            plot={plot}
            points={innerArea.upper}
            lowerPoints={innerArea.lower}
            color={accent}
            fillOpacity={0.32}
          />
        ) : null}
        {median ? (
          <LineSeries
            plot={plot}
            points={median}
            color={PDF_THEME.ink}
            strokeWidth={1.4}
          />
        ) : null}
        <AxisX plot={plot} years={xs} />
        <AxisY plot={plot} format={fmtCompactDollar} />
      </Svg>
    </View>
  );
}
