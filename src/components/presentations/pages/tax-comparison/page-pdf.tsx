import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type {
  TaxComparisonPageData,
  TaxComparisonKpi,
  CompositionSide,
} from "@/lib/presentations/pages/tax-comparison/view-model";
import { fmtUsd } from "@/lib/presentations/pages/tax-summary/aggregate";
import { TaxComparisonChartPdf } from "./chart-pdf";

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 8, color: T.ink2, marginBottom: 6 },
  kpis: { flexDirection: "row", gap: 8, marginBottom: 8 },
  kpi: { flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderRadius: 3, padding: 6 },
  kpiLbl: { fontSize: 6.5, color: T.ink2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 },
  kpiPair: { flexDirection: "row", alignItems: "baseline", marginTop: 3 },
  kpiBase: { fontSize: 9, color: T.ink3 },
  kpiArrow: { fontSize: 8, color: T.ink3, marginHorizontal: 3 },
  kpiScn: { fontSize: 13, fontWeight: 700, color: T.ink },
  kpiDelta: { fontSize: 8, fontWeight: 700, marginTop: 1 },
  body: { flexDirection: "row", gap: 10 },
  panel: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderRadius: 3, padding: 10 },
  panelLeft: { flexBasis: "56%" },
  panelRight: { flexBasis: "44%" },
  h4: { fontSize: 8, color: T.ink2, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 },
  cmpHead: { flexDirection: "row", paddingBottom: 2, borderBottomWidth: 1, borderBottomColor: T.hair2 },
  cmpHeadLbl: { flex: 1, fontSize: 6.5, color: T.ink3, fontWeight: 700, textTransform: "uppercase" },
  cmpHeadCell: { width: 52, fontSize: 6.5, color: T.ink3, fontWeight: 700, textTransform: "uppercase", textAlign: "right" },
  cmpRow: { flexDirection: "row", alignItems: "center", paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: T.hair2 },
  cmpLbl: { flex: 1, fontSize: 8, color: T.ink },
  cmpBase: { width: 52, fontSize: 8, color: T.ink3, textAlign: "right" },
  cmpScn: { width: 52, fontSize: 9, fontWeight: 700, color: T.ink, textAlign: "right" },
  cmpDelta: { width: 52, fontSize: 8, fontWeight: 700, textAlign: "right" },
  note: { fontSize: 6.5, color: T.ink3, marginTop: 4 },
  compTrackLbl: { fontSize: 6.5, color: T.ink3, fontWeight: 700, textTransform: "uppercase", marginTop: 6 },
  splitTrack: { flexDirection: "row", height: 12, borderRadius: 2, overflow: "hidden", marginTop: 2 },
  swatch: { width: 6, height: 6, marginRight: 4 },
  compLabelCell: { flexDirection: "row", alignItems: "center", flex: 1 },
  narr: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderLeftWidth: 3, borderLeftColor: T.accent, borderRadius: 3, padding: 7, marginTop: 6 },
  narrText: { fontSize: 8, color: T.ink, lineHeight: 1.35, marginBottom: 1.5 },
  empty: { fontSize: 11, color: T.ink2, textAlign: "center", marginTop: 60 },
});

const COMP_SEGMENTS = [
  { key: "roth" as const, label: "Roth", color: T.good },
  { key: "preTax" as const, label: "Pre-tax", color: T.crit },
  { key: "taxable" as const, label: "Taxable", color: T.steel },
];

function deltaColor(direction: 1 | -1 | 0): string {
  return direction === 1 ? T.good : direction === -1 ? T.crit : T.ink;
}
function signedUsd(delta: number): string {
  return `${delta >= 0 ? "+" : "−"}${fmtUsd(Math.abs(delta))}`;
}

function KpiCard({ kpi }: { kpi: TaxComparisonKpi }) {
  return (
    <View style={s.kpi}>
      <Text style={s.kpiLbl}>{kpi.label}</Text>
      <View style={s.kpiPair}>
        <Text style={s.kpiBase}>{kpi.base}</Text>
        <Text style={s.kpiArrow}>→</Text>
        <Text style={s.kpiScn}>{kpi.scenario}</Text>
      </View>
      {kpi.show && kpi.delta ? <Text style={[s.kpiDelta, { color: deltaColor(kpi.direction) }]}>{kpi.delta}</Text> : null}
    </View>
  );
}

function SplitBar({ side }: { side: CompositionSide }) {
  if (side.total <= 0) return null;
  return (
    <View style={s.splitTrack}>
      {COMP_SEGMENTS.map((seg) => {
        const pct = (side[seg.key] / side.total) * 100;
        if (pct <= 0) return null;
        return <View key={seg.key} style={{ width: `${pct}%`, backgroundColor: seg.color }} />;
      })}
    </View>
  );
}

export function TaxComparisonPagePdf(input: RenderPdfInput<TaxComparisonPageData>) {
  const { data, firmName, clientName, reportDate, pageIndex, totalPages } = input;
  return (
    <PageFrame firmName={firmName} clientName={clientName} reportDate={reportDate} pageIndex={pageIndex} totalPages={totalPages} orientation="landscape">
      <Text style={s.title}>{data.title}</Text>
      <Text style={s.subtitle}>{data.subtitle}</Text>

      {data.isEmpty ? (
        <Text style={s.empty}>Choose a scenario to compare.</Text>
      ) : (
        <>
          <View style={s.kpis}>
            {data.kpis.map((kpi) => (
              <KpiCard key={kpi.label} kpi={kpi} />
            ))}
          </View>

          <View style={s.body}>
            <View style={[s.panel, s.panelLeft]}>
              <Text style={s.h4}>Taxes paid by year (proposed)</Text>
              <TaxComparisonChartPdf years={data.chart} />
            </View>

            <View style={[s.panel, s.panelRight]}>
              {data.bracket ? (
                <>
                  <Text style={s.h4}>Bracket exposure</Text>
                  <View style={s.cmpHead}>
                    <Text style={s.cmpHeadLbl}> </Text>
                    <Text style={s.cmpHeadCell}>Base</Text>
                    <Text style={s.cmpHeadCell}>Proposed</Text>
                    <Text style={s.cmpHeadCell}>Δ</Text>
                  </View>
                  {data.bracket.map((row) => (
                    <View key={row.label} style={s.cmpRow}>
                      <Text style={s.cmpLbl}>{row.label}</Text>
                      <Text style={s.cmpBase}>{row.base}</Text>
                      <Text style={s.cmpScn}>{row.scenario}</Text>
                      <Text style={[s.cmpDelta, { color: deltaColor(row.direction) }]}>{row.delta}</Text>
                    </View>
                  ))}
                </>
              ) : (
                <Text style={s.note}>Bracket detail is unavailable in flat-tax mode.</Text>
              )}

              {data.composition && (data.composition.base.total > 0 || data.composition.scenario.total > 0) ? (
                <View style={{ marginTop: 10 }}>
                  <Text style={s.h4}>{`Account composition at retirement (${data.composition.year})`}</Text>
                  <Text style={s.compTrackLbl}>Base</Text>
                  <SplitBar side={data.composition.base} />
                  <Text style={s.compTrackLbl}>Proposed</Text>
                  <SplitBar side={data.composition.scenario} />
                  <View style={[s.cmpHead, { marginTop: 6 }]}>
                    <Text style={s.cmpHeadLbl}> </Text>
                    <Text style={s.cmpHeadCell}>Base</Text>
                    <Text style={s.cmpHeadCell}>Proposed</Text>
                    <Text style={s.cmpHeadCell}>Δ</Text>
                  </View>
                  {COMP_SEGMENTS.map((seg) => {
                    const base = data.composition!.base[seg.key];
                    const scn = data.composition!.scenario[seg.key];
                    return (
                      <View key={seg.key} style={s.cmpRow}>
                        <View style={s.compLabelCell}>
                          <View style={[s.swatch, { backgroundColor: seg.color }]} />
                          <Text style={s.cmpLbl}>{seg.label}</Text>
                        </View>
                        <Text style={s.cmpBase}>{fmtUsd(base)}</Text>
                        <Text style={s.cmpScn}>{fmtUsd(scn)}</Text>
                        <Text style={s.cmpDelta}>{signedUsd(scn - base)}</Text>
                      </View>
                    );
                  })}
                  <View style={s.cmpRow}>
                    <Text style={[s.cmpLbl, { fontWeight: 700 }]}>Total</Text>
                    <Text style={s.cmpBase}>{fmtUsd(data.composition.base.total)}</Text>
                    <Text style={s.cmpScn}>{fmtUsd(data.composition.scenario.total)}</Text>
                    <Text style={s.cmpDelta}>{signedUsd(data.composition.scenario.total - data.composition.base.total)}</Text>
                  </View>
                </View>
              ) : null}
            </View>
          </View>

          <View style={s.narr}>
            {data.narrative.map((line, i) => (
              <Text key={i} style={s.narrText}>{i === 0 ? "Comparison. " : ""}{line}</Text>
            ))}
          </View>
        </>
      )}
    </PageFrame>
  );
}
