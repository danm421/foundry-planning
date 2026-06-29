import { Text, View, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T, type SectionAccent } from "@/lib/presentations/theme";
import { PageFrame } from "../../shared/page-frame";
import { SectionHead } from "../../shared/section-head";
import { DrillTablePdf } from "../../shared/drill-table-pdf";
import { FanChartPdf } from "./charts/fan-pdf";
import { HistogramPdf } from "./charts/histogram-pdf";
import { SuccessPdf } from "./charts/success-pdf";
import type { MonteCarloPageData } from "@/lib/presentations/pages/monte-carlo/view-model";
import { MONTE_CARLO_CHART_KINDS, type MonteCarloChartKind } from "@/lib/presentations/pages/monte-carlo/options-schema";

const styles = StyleSheet.create({
  kpiRow: { flexDirection: "row", gap: 8, marginTop: 10, marginBottom: 12 },
  kpiBox: { flex: 1, borderRadius: 4, borderWidth: 1, borderColor: T.hair2, backgroundColor: T.card, padding: 8 },
  kpiLabel: { fontSize: 7, color: T.ink2, textTransform: "uppercase", letterSpacing: 0.5 },
  kpiValue: { fontSize: 13, color: T.ink, fontFamily: "Inter", marginTop: 3 },
  hero: { marginBottom: 10 },
  thumbRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  thumb: { flex: 1, borderRadius: 4, borderWidth: 1, borderColor: T.hair2, padding: 6 },
  thumbLabel: { fontSize: 7, color: T.ink3, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 },
  footnote: { fontSize: 6, color: T.ink3, marginTop: 6 },
  empty: { fontSize: 11, color: T.ink3, textAlign: "center", marginTop: 60 },
});

const CHART_LABEL: Record<MonteCarloChartKind, string> = {
  fan: "Portfolio over time",
  histogram: "Ending distribution",
  longevity: "Success over time",
};

function Chart({ kind, data, scale }: { kind: MonteCarloChartKind; data: MonteCarloPageData; scale: number }) {
  // Legend only on the full-size hero render (scale 1); thumbnails stay clean.
  if (kind === "fan") return <FanChartPdf spec={data.fan} scale={scale} legend={scale === 1} />;
  if (kind === "histogram") return <HistogramPdf spec={data.histogram} scale={scale} />;
  return <SuccessPdf spec={data.success} scale={scale} />;
}

export function MonteCarloPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  accent,
}: {
  data: MonteCarloPageData;
  firmName: string;
  clientName: string;
  reportDate: string;
  pageIndex: number;
  totalPages: number;
  accent: SectionAccent;
}) {
  const others = MONTE_CARLO_CHART_KINDS.filter((k) => k !== data.heroKind);

  return (
    <PageFrame
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
      orientation="portrait"
    >
      <SectionHead title={data.title} subtitle={data.subtitle} eyebrow="Monte Carlo" accent={accent} />

      {!data.available ? (
        <Text style={styles.empty}>Monte Carlo data unavailable for this scenario.</Text>
      ) : (
        <>
          <View style={styles.kpiRow}>
            {data.kpis.map((k) => (
              <View key={k.label} style={styles.kpiBox}>
                <Text style={styles.kpiLabel}>{k.label}</Text>
                <Text style={styles.kpiValue}>{k.value}</Text>
              </View>
            ))}
          </View>

          <View style={styles.hero}>
            <Text style={styles.thumbLabel}>{CHART_LABEL[data.heroKind]}</Text>
            <Chart kind={data.heroKind} data={data} scale={1} />
          </View>

          <View style={styles.thumbRow}>
            {others.map((k) => (
              <View key={k} style={styles.thumb}>
                <Text style={styles.thumbLabel}>{CHART_LABEL[k]}</Text>
                <Chart kind={k} data={data} scale={0.46} />
              </View>
            ))}
          </View>

          <DrillTablePdf
            data={{
              title: "",
              subtitle: "",
              table: data.table,
              footnote: "",
            }}
            accent={accent}
          />

          <Text style={styles.footnote}>{data.footnote}</Text>
        </>
      )}
    </PageFrame>
  );
}
