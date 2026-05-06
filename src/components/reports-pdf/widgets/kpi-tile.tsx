// src/components/reports-pdf/widgets/kpi-tile.tsx
//
// PDF render for the kpiTile widget. Mirrors the screen render
// structure (category eyebrow, big value, title, optional delta) but
// uses @react-pdf/renderer primitives + PDF_THEME tokens so the output
// is print-faithful.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import { getMetric, formatMetric } from "@/lib/reports/metric-registry";
import { PDF_THEME } from "../theme";

const s = StyleSheet.create({
  tile: {
    padding: 14,
    borderWidth: 1,
    borderColor: PDF_THEME.hair,
    backgroundColor: "#ffffff",
    borderRadius: 4,
  },
  category: {
    fontFamily: "JetBrains Mono",
    fontSize: 8,
    color: PDF_THEME.ink3,
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  value: { fontSize: 22, color: PDF_THEME.ink, fontWeight: 600 },
  title: { fontSize: 10, color: PDF_THEME.ink2, marginTop: 4 },
  delta: { fontFamily: "JetBrains Mono", fontSize: 9, marginTop: 6 },
});

export function KpiTilePdfRender({ props, data }: WidgetRenderProps<"kpiTile">) {
  const m = getMetric(props.metricKey);
  const d = data as { value: number | null; prevValue?: number | null } | null;
  const value = d?.value ?? null;
  const prev = d?.prevValue ?? null;
  const delta =
    props.showDelta && value !== null && prev != null ? value - prev : null;
  return (
    <View style={s.tile}>
      <Text style={s.category}>{m.category}</Text>
      <Text style={s.value}>{formatMetric(value, m.format)}</Text>
      <Text style={s.title}>{props.titleOverride || m.label}</Text>
      {delta != null && (
        <Text
          style={[
            s.delta,
            { color: delta >= 0 ? PDF_THEME.good : PDF_THEME.crit },
          ]}
        >
          {delta >= 0 ? "+" : ""}
          {formatMetric(delta, m.format)} vs last year
        </Text>
      )}
    </View>
  );
}
