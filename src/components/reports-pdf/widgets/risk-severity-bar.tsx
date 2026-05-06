// src/components/reports-pdf/widgets/risk-severity-bar.tsx
//
// Native vector PDF render for the riskSeverityBar widget. Horizontal
// bars — one row per risk. Bar length = severity tier (1=low, 2=medium,
// 3=high) mapped to the chart inner width; bar color = severity color
// (low → good, medium → accent, high → crit).
//
// Hand-rolled SVG layout rather than the shared chart primitives:
// `BarSeries` is x-axis-major (one bar per X tick) and this chart is
// y-axis-major (one bar per Y row). We use the lower-level `<Svg>`,
// `<Rect>`, `<Text>`, `<Line>` re-exports from pdf-chart-primitives so
// the visual treatment (hair lines, ink colors, fonts) stays consistent
// with the rest of the PDF chart family.

import { View, Text as PdfText, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";
import { Svg, Rect, Line, Text } from "../pdf-chart-primitives";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { RiskSeverity } from "@/lib/reports/types";

const SEVERITY_TIER: Record<RiskSeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

const SEVERITY_COLOR: Record<RiskSeverity, string> = {
  low: PDF_THEME.good,
  medium: PDF_THEME.accent,
  high: PDF_THEME.crit,
};

const TIER_LABELS = ["Low", "Medium", "High"] as const;

const s = StyleSheet.create({
  wrap: {
    padding: 12,
    borderWidth: 1,
    borderColor: PDF_THEME.hair,
    backgroundColor: PDF_THEME.card2,
    borderRadius: PDF_THEME.radii.card,
  },
  title: {
    fontFamily: "Fraunces",
    fontSize: PDF_THEME.type.titleSubsection.pdfPx,
    color: PDF_THEME.ink,
    marginBottom: 6,
  },
  placeholder: {
    fontSize: PDF_THEME.type.caption.pdfPx,
    color: PDF_THEME.ink3,
    textAlign: "center",
    paddingVertical: 12,
  },
});

export function RiskSeverityBarPdfRender({
  props,
  width = 480,
}: WidgetRenderProps<"riskSeverityBar"> & { width?: number }) {
  const rows = props.rows;

  if (rows.length === 0) {
    return (
      <View style={s.wrap}>
        <PdfText style={s.title}>{props.title}</PdfText>
        <PdfText style={s.placeholder}>No risks identified.</PdfText>
      </View>
    );
  }

  // Layout — left column reserved for row labels; right column holds the
  // horizontal bars and the bottom tick labels.
  const labelColWidth = 120;
  const padLeft = 4;
  const padRight = 12;
  const padTop = 6;
  const rowHeight = 22;
  const barHeight = 12;
  const axisLabelHeight = 16;
  const innerWidth = width - labelColWidth - padLeft - padRight;
  const plotHeight = rows.length * rowHeight;
  const svgHeight = padTop + plotHeight + axisLabelHeight;

  // Severity tier maps to fraction of inner width (1 → 1/3, 2 → 2/3, 3 → 1).
  const tierToWidth = (tier: number) => (tier / 3) * innerWidth;

  // X positions of the three tick marks at fractions 1/3, 2/3, 1.
  const tickXs = [1, 2, 3].map(
    (tier) => labelColWidth + padLeft + tierToWidth(tier),
  );

  return (
    <View style={s.wrap}>
      <PdfText style={s.title}>{props.title}</PdfText>
      <Svg width={width} height={svgHeight}>
        {/* Vertical axis line on the left edge of the plot area */}
        <Line
          x1={labelColWidth + padLeft}
          x2={labelColWidth + padLeft}
          y1={padTop}
          y2={padTop + plotHeight}
          stroke={PDF_THEME.hair}
          strokeWidth={0.5}
        />
        {/* Hairline tick markers behind the bars */}
        {tickXs.map((x, i) => (
          <Line
            key={i}
            x1={x}
            x2={x}
            y1={padTop}
            y2={padTop + plotHeight}
            stroke={PDF_THEME.hair}
            strokeWidth={0.5}
            strokeDasharray="2 3"
          />
        ))}
        {rows.map((row, i) => {
          const tier = SEVERITY_TIER[row.severity];
          const barW = tierToWidth(tier);
          const yCenter = padTop + i * rowHeight + rowHeight / 2;
          return (
            <Rect
              key={`bar-${i}`}
              x={labelColWidth + padLeft}
              y={yCenter - barHeight / 2}
              width={barW}
              height={barHeight}
              fill={SEVERITY_COLOR[row.severity]}
            />
          );
        })}
        {/* Row labels — rendered after bars so they sit above any rounding overlap */}
        {rows.map((row, i) => {
          const yCenter = padTop + i * rowHeight + rowHeight / 2;
          return (
            <Text
              key={`label-${i}`}
              x={labelColWidth - 6}
              y={yCenter + 3}
              fill={PDF_THEME.ink}
              textAnchor="end"
              style={{ fontSize: 9 }}
            >
              {row.area}
            </Text>
          );
        })}
        {/* X-axis tick labels: Low / Medium / High */}
        {TIER_LABELS.map((label, i) => (
          <Text
            key={`tick-${i}`}
            x={tickXs[i]}
            y={padTop + plotHeight + 11}
            fill={PDF_THEME.ink3}
            textAnchor="middle"
            style={{ fontSize: 8 }}
          >
            {label}
          </Text>
        ))}
      </Svg>
    </View>
  );
}
