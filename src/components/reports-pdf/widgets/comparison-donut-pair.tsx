// src/components/reports-pdf/widgets/comparison-donut-pair.tsx
//
// Native vector PDF render for the comparisonDonutPair widget. Two
// donuts side-by-side ("Current" left, "Proposed" right) — same
// composition as `allocationDonut`, doubled. Shared legend below when
// `showLegend` is true.

import { StyleSheet, Text, View } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";
import {
  DonutSeries,
  Legend,
  Svg,
  ValueLabel,
  fmtCompactDollar,
} from "../pdf-chart-primitives";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { ComparisonScopeData } from "@/lib/reports/scopes/comparison";
import type { AllocationScopeData } from "@/lib/reports/scopes/allocation";

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

type CompPayload = { comparison?: ComparisonScopeData } | null | undefined;

function buildSlices(allocation: AllocationScopeData) {
  return allocation.byClass.map((c, i) => ({
    label: c.className,
    value: c.value,
    color: PDF_THEME.chart[i % PDF_THEME.chart.length],
  }));
}

export function ComparisonDonutPairPdfRender({
  props,
  data,
  width = 480,
  height = 240,
}: WidgetRenderProps<"comparisonDonutPair"> & {
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

  const curSlices = buildSlices(comparison.current.allocation);
  const propSlices = buildSlices(comparison.proposed.allocation);
  const curTotal = curSlices.reduce((sum, sl) => sum + sl.value, 0);
  const propTotal = propSlices.reduce((sum, sl) => sum + sl.value, 0);

  // Layout: title above, two donuts in row, legend below.
  const legendHeight = props.showLegend ? 22 : 0;
  const headerHeight = 20; // "CURRENT" / "PROPOSED" eyebrows above each donut
  const donutAreaHeight = height - legendHeight - headerHeight;

  const halfWidth = width / 2;
  const cyDonut = headerHeight + donutAreaHeight / 2;
  const outerR = Math.min(halfWidth, donutAreaHeight) / 2 - 14;
  const innerR = outerR * 0.6;
  const cxLeft = halfWidth / 2;
  const cxRight = halfWidth + halfWidth / 2;

  // Shared legend: dedupe by className across both sides, preserving the
  // first encounter's index so colors line up with the per-side palette.
  const sharedLegendItems: { label: string; color: string }[] = [];
  const seen = new Set<string>();
  [...curSlices, ...propSlices].forEach((sl) => {
    if (seen.has(sl.label)) return;
    seen.add(sl.label);
    sharedLegendItems.push({ label: sl.label, color: sl.color });
  });

  return (
    <View style={s.wrap}>
      <Text style={s.title}>{props.title}</Text>
      {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
      <Svg width={width} height={height}>
        {/* Side eyebrows */}
        <ValueLabel
          x={cxLeft}
          y={12}
          text="CURRENT"
          color={PDF_THEME.ink3}
          fontSize={8}
          textAnchor="middle"
        />
        <ValueLabel
          x={cxRight}
          y={12}
          text="PROPOSED"
          color={PDF_THEME.ink3}
          fontSize={8}
          textAnchor="middle"
        />
        <DonutSeries
          slices={curSlices}
          cx={cxLeft}
          cy={cyDonut}
          outerRadius={outerR}
          innerRadius={innerR}
          centerLabel={fmtCompactDollar(curTotal)}
          centerSubLabel="Total"
        />
        <DonutSeries
          slices={propSlices}
          cx={cxRight}
          cy={cyDonut}
          outerRadius={outerR}
          innerRadius={innerR}
          centerLabel={fmtCompactDollar(propTotal)}
          centerSubLabel="Total"
        />
        {props.showLegend ? (
          <Legend
            items={sharedLegendItems}
            x={12}
            y={height - legendHeight / 2}
            orientation="horizontal"
          />
        ) : null}
      </Svg>
    </View>
  );
}

