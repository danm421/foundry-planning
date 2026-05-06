// src/components/reports-pdf/widgets/allocation-donut.tsx
//
// Native vector PDF render for the allocationDonut widget. Donut on the
// left, legend on the right. Total dollars render in the center of the
// hole when slices are present.
//
// `props.innerRingAssetType` is wired through but a no-op in v1 — the
// engine doesn't expose CMA asset-type rollups at the year level. Same
// situation as the screen render; the toggle stays in the inspector with
// a "coming soon" hint.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";
import {
  DonutSeries,
  Legend,
  Svg,
  fmtCompactDollar,
} from "../pdf-chart-primitives";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
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

export function AllocationDonutPdfRender({
  props,
  data,
  width = 480,
  height = 220,
}: WidgetRenderProps<"allocationDonut"> & { width?: number; height?: number }) {
  const d = (data as { allocation?: AllocationScopeData })?.allocation;
  const byClass = d?.byClass ?? [];

  if (byClass.length === 0) {
    return (
      <View style={s.wrap}>
        <Text style={s.title}>{props.title}</Text>
        {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
        <Text style={s.placeholder}>Allocation data not available.</Text>
      </View>
    );
  }

  const slices = byClass.map((c, i) => ({
    label: c.className,
    value: c.value,
    color: PDF_THEME.chart[i % PDF_THEME.chart.length],
  }));
  const total = slices.reduce((sum, sl) => sum + sl.value, 0);

  // Donut on left half, legend on right half.
  const donutAreaWidth = props.showLegend ? width * 0.55 : width;
  const cx = donutAreaWidth / 2;
  const cy = height / 2;
  const outerR = Math.min(donutAreaWidth, height) / 2 - 12;
  const innerR = outerR * 0.6;

  return (
    <View style={s.wrap}>
      <Text style={s.title}>{props.title}</Text>
      {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
      <Svg width={width} height={height}>
        <DonutSeries
          slices={slices}
          cx={cx}
          cy={cy}
          outerRadius={outerR}
          innerRadius={innerR}
          centerLabel={fmtCompactDollar(total)}
          centerSubLabel="Total"
        />
        {props.showLegend ? (
          <Legend
            items={slices.map((sl) => ({ label: sl.label, color: sl.color }))}
            x={donutAreaWidth + 8}
            y={cy - (slices.length * 14) / 2 + 8}
            orientation="vertical"
          />
        ) : null}
      </Svg>
    </View>
  );
}
