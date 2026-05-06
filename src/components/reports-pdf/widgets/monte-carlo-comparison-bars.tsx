// src/components/reports-pdf/widgets/monte-carlo-comparison-bars.tsx
//
// Native vector PDF render for the monteCarloComparisonBars widget.
// Two bars side-by-side showing each side's Monte Carlo success
// probability. Big mono value label above each bar so the percentage
// reads at a glance. Current = slate gray; Proposed = sage green.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";
import {
  AxisX,
  AxisY,
  BarSeries,
  GridLines,
  Svg,
  ValueLabel,
  fmtPercent,
  makePlot,
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
const PROPOSED_COLOR = PDF_THEME.good;

type CompPayload = { comparison?: ComparisonScopeData } | null | undefined;

function asPercent(p: number): number {
  if (!Number.isFinite(p)) return 0;
  if (p <= 1.5) return p * 100;
  return p;
}

export function MonteCarloComparisonBarsPdfRender({
  props,
  data,
  width = 480,
  height = 220,
}: WidgetRenderProps<"monteCarloComparisonBars"> & {
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

  const cur = asPercent(comparison.delta.successProbability.current);
  const prop = asPercent(comparison.delta.successProbability.proposed);

  // Two slots — render the bars at categorical x = 1 and x = 2 so the band
  // math has neat margins on either side.
  const xs = [1, 2];
  const xDomain: [number, number] = [0.5, 2.5];
  const yDomain: [number, number] = [0, 100];

  const plot = makePlot({
    width,
    height,
    xDomain,
    yDomain,
    padding: { top: 28, right: 12, bottom: 32, left: 44 },
  });

  // BarSeries draws a single color per call, so render the two bars in two
  // calls — one current (slate), one proposed (good). This is what the
  // primitive is designed for; consistent with how other widgets use it.
  return (
    <View style={s.wrap}>
      <Text style={s.title}>{props.title}</Text>
      {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
      <Svg width={width} height={height}>
        <GridLines plot={plot} ticks={[0, 25, 50, 75, 100]} />
        <BarSeries
          plot={plot}
          points={[{ x: xs[0], value: cur }]}
          color={CURRENT_COLOR}
          barWidth={plot.bandWidth(xs.length) * 0.55}
        />
        <BarSeries
          plot={plot}
          points={[{ x: xs[1], value: prop }]}
          color={PROPOSED_COLOR}
          barWidth={plot.bandWidth(xs.length) * 0.55}
        />
        <AxisY
          plot={plot}
          ticks={[0, 25, 50, 75, 100]}
          format={(n) => fmtPercent(n)}
        />
        {/* Custom X labels — categorical, not numeric. */}
        <AxisX plot={plot} years={xs} ticks={[]} />
        <ValueLabel
          x={plot.xScale(xs[0])}
          y={plot.inner.y + plot.inner.height + 12}
          text="Current"
          color={PDF_THEME.ink2}
          fontSize={9}
          textAnchor="middle"
        />
        <ValueLabel
          x={plot.xScale(xs[1])}
          y={plot.inner.y + plot.inner.height + 12}
          text="Proposed"
          color={PDF_THEME.ink2}
          fontSize={9}
          textAnchor="middle"
        />
        {/* Big value labels above each bar. */}
        <ValueLabel
          x={plot.xScale(xs[0])}
          y={plot.yScale(cur) - 6}
          text={fmtPercent(cur)}
          color={PDF_THEME.ink}
          fontSize={14}
          textAnchor="middle"
        />
        <ValueLabel
          x={plot.xScale(xs[1])}
          y={plot.yScale(prop) - 6}
          text={fmtPercent(prop)}
          color={PDF_THEME.ink}
          fontSize={14}
          textAnchor="middle"
        />
      </Svg>
    </View>
  );
}
