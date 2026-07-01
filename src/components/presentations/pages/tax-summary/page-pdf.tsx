import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { TaxSummaryPageData } from "@/lib/presentations/pages/tax-summary/view-model";
import { fmtUsd, fmtPct } from "@/lib/presentations/pages/tax-summary/aggregate";
import { TaxSummaryChartPdf } from "./chart-pdf";

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 8, color: T.ink2, marginBottom: 6 },
  kpis: { flexDirection: "row", gap: 8, marginBottom: 8 },
  // space-between pins the value to the card bottom so values align across 1- vs 2-line labels
  kpi: { flex: 1, justifyContent: "space-between", backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderRadius: 3, padding: 6 },
  kpiLbl: { fontSize: 6.5, color: T.ink2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 },
  kpiVal: { fontSize: 15, fontWeight: 700, marginTop: 2 },
  body: { flexDirection: "row", gap: 10 },
  panel: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderRadius: 3, padding: 10 },
  panelLeft: { flexBasis: "56%" },
  panelRight: { flexBasis: "44%" },
  h4: { fontSize: 8, color: T.ink2, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 },
  statRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: T.hair2 },
  statLbl: { fontSize: 8, color: T.ink },
  statVal: { fontSize: 9, fontWeight: 700, color: T.ink },
  note: { fontSize: 6.5, color: T.ink3, marginTop: 4 },
  // Composition split bar
  splitTrack: { flexDirection: "row", height: 16, borderRadius: 2, overflow: "hidden", marginTop: 6, marginBottom: 4 },
  swatch: { width: 6, height: 6, marginRight: 4 },
  // Composition value table (below the split bar)
  compTable: { marginTop: 2 },
  compRow: { flexDirection: "row", alignItems: "center", paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: T.hair2 },
  compLabelCell: { flexDirection: "row", alignItems: "center", flex: 1 },
  compLabel: { fontSize: 8, color: T.ink },
  compPct: { fontSize: 8, color: T.ink2, width: 36, textAlign: "right" },
  compAmt: { fontSize: 9, fontWeight: 700, color: T.ink, width: 56, textAlign: "right" },
  compTotalRow: { flexDirection: "row", alignItems: "center", paddingTop: 3, marginTop: 1, borderTopWidth: 1, borderTopColor: T.hair2 },
  compTotalLabel: { fontSize: 8, fontWeight: 700, color: T.ink, flex: 1 },
  compTotalAmt: { fontSize: 9, fontWeight: 700, color: T.ink, width: 56, textAlign: "right" },
  narr: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderLeftWidth: 3, borderLeftColor: T.accent, borderRadius: 3, padding: 7, marginTop: 6 },
  narrText: { fontSize: 8, color: T.ink, lineHeight: 1.35, marginBottom: 1.5 },
  empty: { fontSize: 11, color: T.ink2, textAlign: "center", marginTop: 60 },
});

function Kpi({ lbl, val }: { lbl: string; val: string }) {
  return (
    <View style={s.kpi}>
      <Text style={s.kpiLbl}>{lbl}</Text>
      <Text style={s.kpiVal}>{val}</Text>
    </View>
  );
}

const COMP_SEGMENTS = [
  { key: "roth" as const, label: "Roth", color: T.good },
  { key: "preTax" as const, label: "Pre-tax", color: T.crit },
  { key: "taxable" as const, label: "Taxable", color: T.steel },
];

export function TaxSummaryPagePdf(input: RenderPdfInput<TaxSummaryPageData>) {
  const { data, firmName, clientName, reportDate, pageIndex, totalPages } = input;
  return (
    <PageFrame firmName={firmName} clientName={clientName} reportDate={reportDate} pageIndex={pageIndex} totalPages={totalPages} orientation="landscape">
      <Text style={s.title}>{data.title}</Text>
      <Text style={s.subtitle}>{data.subtitle}</Text>

      {data.isEmpty ? (
        <Text style={s.empty}>No tax data available for this scenario.</Text>
      ) : (
        <>
          <View style={s.kpis}>
            <Kpi lbl="Lifetime Federal Tax" val={fmtUsd(data.kpis.lifetimeFederal)} />
            <Kpi lbl="Lifetime State Tax" val={fmtUsd(data.kpis.lifetimeState)} />
            <Kpi lbl="Lifetime Capital Gains Tax" val={fmtUsd(data.kpis.lifetimeCapGains)} />
            <Kpi lbl="Lifetime Total Tax" val={fmtUsd(data.kpis.lifetimeTotal)} />
            <Kpi lbl="Lifetime Effective Rate" val={fmtPct(data.kpis.effectiveRate)} />
          </View>

          <View style={s.body}>
            <View style={[s.panel, s.panelLeft]}>
              <Text style={s.h4}>Taxes paid by year</Text>
              <TaxSummaryChartPdf bars={data.chart} />
            </View>

            <View style={[s.panel, s.panelRight]}>
              {data.bracket ? (
                <>
                  <Text style={s.h4}>Bracket exposure</Text>
                  <View style={s.statRow}>
                    <Text style={s.statLbl}>{`Years below the ${fmtPct(data.bracket.lowThreshold)} bracket`}</Text>
                    <Text style={s.statVal}>{data.bracket.yearsBelowLow}</Text>
                  </View>
                  <View style={s.statRow}>
                    <Text style={s.statLbl}>{`Years above the ${fmtPct(data.bracket.highThreshold)} bracket`}</Text>
                    <Text style={s.statVal}>{data.bracket.yearsAboveHigh}</Text>
                  </View>
                  {data.bracket.minRate != null && data.bracket.maxRate != null ? (
                    <View style={s.statRow}>
                      <Text style={s.statLbl}>Marginal rate range</Text>
                      <Text style={s.statVal}>{`${fmtPct(data.bracket.minRate)} – ${fmtPct(data.bracket.maxRate)}`}</Text>
                    </View>
                  ) : null}
                </>
              ) : (
                <Text style={s.note}>Bracket detail is unavailable in flat-tax mode.</Text>
              )}

              {data.composition && data.composition.total > 0 ? (
                <View style={{ marginTop: 10 }}>
                  <Text style={s.h4}>{`Account composition at retirement (${data.composition.year})`}</Text>
                  <View style={s.splitTrack}>
                    {COMP_SEGMENTS.map((seg) => {
                      const v = data.composition![seg.key];
                      const pct = (v / data.composition!.total) * 100;
                      if (pct <= 0) return null;
                      return <View key={seg.key} style={{ width: `${pct}%`, backgroundColor: seg.color }} />;
                    })}
                  </View>
                  <View style={s.compTable}>
                    {COMP_SEGMENTS.map((seg) => {
                      const v = data.composition![seg.key];
                      const pct = (v / data.composition!.total) * 100;
                      return (
                        <View key={seg.key} style={s.compRow}>
                          <View style={s.compLabelCell}>
                            <View style={[s.swatch, { backgroundColor: seg.color }]} />
                            <Text style={s.compLabel}>{seg.label}</Text>
                          </View>
                          <Text style={s.compPct}>{`${Math.round(pct)}%`}</Text>
                          <Text style={s.compAmt}>{fmtUsd(v)}</Text>
                        </View>
                      );
                    })}
                    <View style={s.compTotalRow}>
                      <Text style={s.compTotalLabel}>Total</Text>
                      <Text style={s.compTotalAmt}>{fmtUsd(data.composition.total)}</Text>
                    </View>
                  </View>
                </View>
              ) : null}
            </View>
          </View>

          <View style={s.narr}>
            {data.narrative.map((line, i) => (
              <Text key={i} style={s.narrText}>{i === 0 ? "Takeaways. " : ""}{line}</Text>
            ))}
          </View>
        </>
      )}
    </PageFrame>
  );
}