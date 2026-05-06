// src/components/reports-pdf/widgets/cashflow-bar-chart.tsx
//
// PDF render for the cashflowBarChart widget. Receives a pre-rendered PNG
// data-URI via `chartImage` (the builder snapshots the live Chart.js canvas
// before posting to the export route). Falls back to a placeholder string
// when the snapshot is missing — better than failing the whole export when
// a single chart can't be captured.

import { View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";

const s = StyleSheet.create({
  wrap: {
    padding: 12,
    borderWidth: 1,
    borderColor: PDF_THEME.hair,
    backgroundColor: PDF_THEME.card2,
    borderRadius: 4,
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

export function CashflowBarChartPdfRender({
  props,
  chartImage,
}: WidgetRenderProps<"cashflowBarChart">) {
  return (
    <View style={s.wrap}>
      <Text style={s.title}>{props.title}</Text>
      {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
      {chartImage ? (
        // jsx-a11y/alt-text targets HTML <img>; @react-pdf/renderer's <Image>
        // is a PDF primitive with no alt prop. Suppress the false positive.
        // eslint-disable-next-line jsx-a11y/alt-text
        <Image src={chartImage} style={{ width: "100%", height: 240 }} />
      ) : (
        <Text style={s.placeholder}>Chart unavailable</Text>
      )}
    </View>
  );
}
