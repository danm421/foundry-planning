// src/components/reports-pdf/widgets/monte-carlo-fan.tsx
//
// PDF render for the monteCarloFan widget. Receives a pre-rendered PNG
// data-URI via `chartImage` (the builder snapshots the live Chart.js canvas
// before posting to the export route) plus the widget's per-id `data`
// payload so the headline can render in PDF mode without the live scope.
//
// v1 reality: the `monteCarlo` scope is a stub returning
// `{ successProbability: null, bands: [] }`. In that state the headline
// renders as "—" and the chart slot shows the same "not yet available"
// placeholder as the screen render — keeping screen/PDF parity.

import { View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { MonteCarloScopeData } from "@/lib/reports/scopes/monteCarlo";

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
  chartImage,
}: WidgetRenderProps<"monteCarloFan">) {
  const d = (data as { monteCarlo?: MonteCarloScopeData })?.monteCarlo;
  const headline =
    d?.successProbability == null
      ? "—"
      : `${(d.successProbability * 100).toFixed(0)}% chance of success`;
  const hasData = (d?.bands?.length ?? 0) > 0;
  return (
    <View style={s.wrap}>
      <Text style={s.title}>{props.title}</Text>
      {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
      {props.showHeadline ? <Text style={s.headline}>{headline}</Text> : null}
      {chartImage && hasData ? (
        // jsx-a11y/alt-text targets HTML <img>; @react-pdf/renderer's <Image>
        // is a PDF primitive with no alt prop. Suppress the false positive.
        // eslint-disable-next-line jsx-a11y/alt-text
        <Image src={chartImage} style={{ width: "100%", height: 220 }} />
      ) : (
        <Text style={s.placeholder}>
          Monte Carlo trials not yet available.
        </Text>
      )}
    </View>
  );
}
