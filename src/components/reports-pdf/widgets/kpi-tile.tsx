// src/components/reports-pdf/widgets/kpi-tile.tsx
//
// PDF render for the kpiTile widget. Mirrors the screen render's
// Ethos-style treatment: 2px colored top accent rule (per `accentColor`
// prop), mono uppercase category eyebrow, large value, optional title +
// subtitle, optional delta. Card surface is `card2` (white) on the cream
// page; hairline border around the rest of the perimeter.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import { getMetric, formatMetric } from "@/lib/reports/metric-registry";
import { PDF_THEME } from "../theme";

const s = StyleSheet.create({
  tile: {
    // Top edge accent applied inline (color depends on accentColor prop).
    // Other three sides use the standard hair color.
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 1,
    borderRightColor: PDF_THEME.hair,
    borderBottomColor: PDF_THEME.hair,
    borderLeftColor: PDF_THEME.hair,
    borderTopWidth: 2,
    backgroundColor: PDF_THEME.card2,
    borderRadius: PDF_THEME.radii.card,
  },
  inner: { padding: 14 },
  category: {
    fontFamily: "JetBrains Mono",
    fontSize: PDF_THEME.type.labelKpi.pdfPx,
    color: PDF_THEME.ink2,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  value: {
    fontSize: PDF_THEME.type.valueKpi.pdfPx,
    color: PDF_THEME.ink,
    fontWeight: 500,
  },
  title: {
    fontSize: PDF_THEME.type.body.pdfPx,
    color: PDF_THEME.ink2,
    marginTop: 4,
  },
  subtitle: {
    fontSize: PDF_THEME.type.caption.pdfPx,
    color: PDF_THEME.ink3,
    marginTop: 2,
  },
  delta: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    marginTop: 8,
  },
});

export function KpiTilePdfRender({ props, data }: WidgetRenderProps<"kpiTile">) {
  const m = getMetric(props.metricKey);
  const d = data as { value: number | null; prevValue?: number | null } | null;
  const value = d?.value ?? null;
  const prev = d?.prevValue ?? null;
  const delta =
    props.showDelta && value !== null && prev != null ? value - prev : null;
  const accentKey = props.accentColor ?? "accent";
  const accentColor = PDF_THEME.category[accentKey];

  return (
    <View style={[s.tile, { borderTopColor: accentColor }]}>
      <View style={s.inner}>
        <Text style={s.category}>{m.category}</Text>
        <Text style={s.value}>{formatMetric(value, m.format)}</Text>
        <Text style={s.title}>{props.titleOverride || m.label}</Text>
        {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
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
    </View>
  );
}
