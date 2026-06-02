import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { TaxSummaryPageData, TaxOpportunities } from "@/lib/presentations/pages/tax-summary/view-model";
import { fmtUsd, fmtPct } from "@/lib/presentations/pages/tax-summary/aggregate";
import { TaxSummaryChartPdf } from "./chart-pdf";

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 8, color: T.ink2, marginBottom: 6 },
  kpis: { flexDirection: "row", gap: 8, marginBottom: 8 },
  kpi: { flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.hair, borderRadius: 3, padding: 6 },
  kpiLbl: { fontSize: 6.5, color: T.ink3, textTransform: "uppercase", letterSpacing: 0.4 },
  kpiVal: { fontSize: 15, fontWeight: 700, marginTop: 2 },
  body: { flexDirection: "row", gap: 10 },
  panel: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair, borderRadius: 3, padding: 10 },
  panelLeft: { flexBasis: "56%" },
  panelRight: { flexBasis: "44%" },
  h4: { fontSize: 8, color: T.ink2, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 },
  statRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: T.hair },
  statLbl: { fontSize: 8, color: T.ink },
  statVal: { fontSize: 9, fontWeight: 700, color: T.ink },
  note: { fontSize: 6.5, color: T.ink3, marginTop: 4 },
  // Composition split bar
  splitTrack: { flexDirection: "row", height: 16, borderRadius: 2, overflow: "hidden", marginTop: 6, marginBottom: 4 },
  splitLegend: { flexDirection: "row", flexWrap: "wrap", marginTop: 2 },
  legendItem: { flexDirection: "row", alignItems: "center", marginRight: 10, marginBottom: 2 },
  swatch: { width: 6, height: 6, marginRight: 3 },
  legendTxt: { fontSize: 7, color: T.ink2 },
  narr: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair, borderLeftWidth: 3, borderLeftColor: T.accent, borderRadius: 3, padding: 7, marginTop: 6 },
  narrText: { fontSize: 8, color: T.ink, lineHeight: 1.35, marginBottom: 1.5 },
  empty: { fontSize: 11, color: T.ink2, textAlign: "center", marginTop: 60 },
  // Opportunities page
  row: { flexDirection: "row" },
  th: { fontSize: 6.5, color: T.ink3, textTransform: "uppercase" },
  td: { fontSize: 7.5, color: T.ink },
  cell: { flex: 1, textAlign: "right", paddingVertical: 1, paddingHorizontal: 2 },
  cellL: { flex: 1.2, textAlign: "left", paddingVertical: 1, paddingHorizontal: 2 },
  hair: { borderBottomWidth: 0.5, borderBottomColor: T.hair },
  grp: { backgroundColor: T.accentTint, fontSize: 6.5, fontWeight: 700, textTransform: "uppercase", paddingVertical: 2, paddingHorizontal: 2, marginTop: 6, marginBottom: 2 },
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

function OpportunitiesPage({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  opp,
}: RenderPdfInput<TaxSummaryPageData> & { opp: TaxOpportunities }) {
  return (
    <PageFrame firmName={firmName} clientName={clientName} reportDate={reportDate} pageIndex={pageIndex} totalPages={totalPages} orientation="landscape">
      <Text style={s.title}>Tax Planning Opportunities</Text>
      <Text style={s.subtitle}>{data.subtitle}</Text>

      {opp.rothConversions.length > 0 ? (
        <>
          <Text style={s.grp}>Roth conversions</Text>
          <View style={s.row}>
            <Text style={[s.cellL, s.th]}>Year</Text>
            <Text style={[s.cell, s.th]}>Gross</Text>
            <Text style={[s.cell, s.th]}>Taxable</Text>
            <Text style={[s.cell, s.th]}>Marginal rate</Text>
          </View>
          {opp.rothConversions.map((r) => (
            <View key={r.year} style={[s.row, s.hair]}>
              <Text style={[s.cellL, s.td]}>{r.year}</Text>
              <Text style={[s.cell, s.td]}>{fmtUsd(r.gross)}</Text>
              <Text style={[s.cell, s.td]}>{fmtUsd(r.taxable)}</Text>
              <Text style={[s.cell, s.td]}>{fmtPct(r.marginalRate)}</Text>
            </View>
          ))}
        </>
      ) : null}

      {opp.capGainsEvents.length > 0 ? (
        <>
          <Text style={s.grp}>Capital-gains events</Text>
          <View style={s.row}>
            <Text style={[s.cellL, s.th]}>Year</Text>
            <Text style={[s.cell, s.th]}>Realized gain</Text>
            <Text style={[s.cell, s.th]}>Cap-gains tax</Text>
          </View>
          {opp.capGainsEvents.map((e) => (
            <View key={e.year} style={[s.row, s.hair]}>
              <Text style={[s.cellL, s.td]}>{e.year}</Text>
              <Text style={[s.cell, s.td]}>{fmtUsd(e.gain)}</Text>
              <Text style={[s.cell, s.td]}>{fmtUsd(e.tax)}</Text>
            </View>
          ))}
        </>
      ) : null}

      {opp.irmaa.length > 0 ? (
        <>
          <Text style={s.grp}>IRMAA Medicare surcharges</Text>
          <View style={s.row}>
            <Text style={[s.cellL, s.th]}>Year</Text>
            <Text style={[s.cell, s.th]}>Surcharge</Text>
          </View>
          {opp.irmaa.map((r) => (
            <View key={r.year} style={[s.row, s.hair]}>
              <Text style={[s.cellL, s.td]}>{r.year}</Text>
              <Text style={[s.cell, s.td]}>{fmtUsd(r.surcharge)}</Text>
            </View>
          ))}
        </>
      ) : null}

      {opp.bracketTimeline.length > 0 ? (
        <>
          <Text style={s.grp}>Marginal bracket by year — low-bracket years are conversion / harvest windows</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 1, marginTop: 2 }}>
            {opp.bracketTimeline.map((p) => (
              <View key={p.year} style={{ alignItems: "center", width: 22, marginBottom: 3 }}>
                <View style={{ width: 18, height: 14, backgroundColor: p.isLow ? T.good : T.accentMuted, borderRadius: 1, alignItems: "center", justifyContent: "center" }}>
                  <Text style={{ fontSize: 5, color: T.card }}>{Math.round(p.rate * 100)}</Text>
                </View>
                <Text style={{ fontSize: 5, color: T.ink3 }}>{`'${String(p.year).slice(2)}`}</Text>
              </View>
            ))}
          </View>
          <Text style={s.note}>Green = below the low-bracket threshold (opportunity years).</Text>
        </>
      ) : null}
    </PageFrame>
  );
}

export function TaxSummaryPagePdf(input: RenderPdfInput<TaxSummaryPageData>) {
  const { data, firmName, clientName, reportDate, pageIndex, totalPages } = input;
  return (
    <>
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
                    <View style={s.splitLegend}>
                      {COMP_SEGMENTS.map((seg) => (
                        <View key={seg.key} style={s.legendItem}>
                          <View style={[s.swatch, { backgroundColor: seg.color }]} />
                          <Text style={s.legendTxt}>{`${seg.label} ${fmtUsd(data.composition![seg.key])}`}</Text>
                        </View>
                      ))}
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

      {!data.isEmpty && data.opportunities ? (
        <OpportunitiesPage {...input} opp={data.opportunities} />
      ) : null}
    </>
  );
}
