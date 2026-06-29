import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { EstateSummaryPageData } from "@/lib/presentations/pages/estate-summary/view-model";
import type { EstateSummaryDeathRow } from "@/lib/presentations/pages/estate-summary/aggregate";
import { fmtUsd, fmtPct } from "@/lib/presentations/pages/estate-summary/aggregate";
import { EstateSummaryChartPdf } from "./chart-pdf";

const s = StyleSheet.create({
  kpis: { flexDirection: "row", gap: 8, marginBottom: 8 },
  kpi: { flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderRadius: 3, padding: 6 },
  kpiLbl: { fontSize: 6.5, color: T.ink3, textTransform: "uppercase", letterSpacing: 0.4 },
  kpiVal: { fontSize: 15, fontWeight: 700, marginTop: 2 },
  kpiSub: { fontSize: 6.5, color: T.ink2, marginTop: 1 },
  body: { flexDirection: "row", gap: 10 },
  panel: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderRadius: 3, padding: 10 },
  panelLeft: { flexBasis: "56%" },
  panelRight: { flexBasis: "44%" },
  h4: { fontSize: 8, color: T.ink2, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 },
  row: { flexDirection: "row" },
  th: { fontSize: 6.5, color: T.ink3, textTransform: "uppercase" },
  td: { fontSize: 7.5, color: T.ink },
  cell: { flex: 1, textAlign: "right", paddingVertical: 1, paddingHorizontal: 3 },
  cellL: { flex: 1.4, textAlign: "left", paddingVertical: 1, paddingHorizontal: 3 },
  grp: { backgroundColor: T.accentTint, fontSize: 6.5, fontWeight: 700, textTransform: "uppercase", paddingVertical: 2, paddingHorizontal: 2, marginTop: 3 },
  hair: { borderBottomWidth: 0.5, borderBottomColor: T.hair2 },
  narr: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderLeftWidth: 3, borderLeftColor: T.accent, borderRadius: 3, padding: 7, marginTop: 6 },
  narrText: { fontSize: 8, color: T.ink, lineHeight: 1.35, marginBottom: 1.5 },
  note: { fontSize: 6.5, color: T.ink3, marginTop: 4 },
  empty: { fontSize: 11, color: T.ink2, textAlign: "center", marginTop: 60 },
});

function Kpi({ lbl, val, sub }: { lbl: string; val: string; sub: string }) {
  return (
    <View style={s.kpi}>
      <Text style={s.kpiLbl}>{lbl}</Text>
      <Text style={s.kpiVal}>{val}</Text>
      <Text style={s.kpiSub}>{sub}</Text>
    </View>
  );
}

function DeathRow({ r }: { r: EstateSummaryDeathRow }) {
  return (
    <View style={[s.row, s.hair]}>
      <Text style={[s.cellL, s.td]}>{`${r.label} · ${r.decedentName}, ${r.year}`}</Text>
      <Text style={[s.cell, s.td]}>{fmtUsd(r.grossEstate)}</Text>
      <Text style={[s.cell, s.td]}>{fmtUsd(r.federal)}</Text>
      <Text style={[s.cell, s.td]}>{fmtUsd(r.state)}</Text>
      <Text style={[s.cell, s.td]}>{fmtUsd(r.probate)}</Text>
      <Text style={[s.cell, s.td]}>{fmtUsd(r.ird)}</Text>
      <Text style={[s.cell, s.td]}>{fmtUsd(r.netAfterTax)}</Text>
    </View>
  );
}

export function EstateSummaryPagePdf({ data, firmName, clientName, reportDate, pageIndex, totalPages }: RenderPdfInput<EstateSummaryPageData>) {
  return (
    <PageFrame
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
      orientation="landscape"
    >
      <Text style={{ fontSize: 16, fontWeight: 700, marginBottom: 2 }}>{data.title}</Text>
      <Text style={{ fontSize: 8, color: T.ink2, marginBottom: 6 }}>{data.subtitle}</Text>

      {data.isEmpty ? (
        <Text style={s.empty}>No estate data available for this scenario.</Text>
      ) : (
        <>
          {/* KPI strip */}
          <View style={s.kpis}>
            <Kpi lbl="Gross Estate · EOL" val={fmtUsd(data.kpis.grossEstateEol)} sub={`Today: ${fmtUsd(data.kpis.grossEstateToday)}`} />
            <Kpi lbl="Total Tax & Costs · EOL" val={fmtUsd(data.kpis.taxAndCostsEol)} sub={`Today: ${fmtUsd(data.kpis.taxAndCostsToday)}`} />
            <Kpi lbl="Net to Heirs · EOL" val={fmtUsd(data.kpis.netToHeirsEol)} sub={`Today: ${fmtUsd(data.kpis.netToHeirsToday)}`} />
            <Kpi lbl="Estate Shrinkage · EOL" val={fmtPct(data.kpis.shrinkageEol)} sub={`Today: ${fmtPct(data.kpis.shrinkageToday)}`} />
          </View>

          <View style={s.body}>
            {/* LEFT: chart + per-death-event table */}
            <View style={[s.panel, s.panelLeft]}>
              <Text style={s.h4}>Estate Today vs. End of Life — where it goes</Text>
              <EstateSummaryChartPdf bars={data.chart} />

              <View style={{ marginTop: 8 }}>
                <View style={s.row}>
                  <Text style={[s.cellL, s.th]}>By death event (Form 706)</Text>
                  <Text style={[s.cell, s.th]}>Gross</Text>
                  <Text style={[s.cell, s.th]}>Federal</Text>
                  <Text style={[s.cell, s.th]}>State</Text>
                  <Text style={[s.cell, s.th]}>Probate</Text>
                  <Text style={[s.cell, s.th]}>IRD</Text>
                  <Text style={[s.cell, s.th]}>Net</Text>
                </View>
                <Text style={s.grp}>Today (if death occurred now)</Text>
                {data.todayRows.map((r) => <DeathRow key={`t-${r.deathOrder}`} r={r} />)}
                <Text style={s.grp}>End of Life (projected death years)</Text>
                {data.eolRows.map((r) => <DeathRow key={`e-${r.deathOrder}`} r={r} />)}
                <Text style={s.note}>
                  Gross is each decedent&apos;s Form 706 chargeable estate (e.g. ~50% of jointly-titled assets at the first death) — a different basis than the headline Gross Estate, so these need not sum to it.
                </Text>
              </View>
            </View>

            {/* RIGHT: distributions */}
            <View style={[s.panel, s.panelRight]}>
              <Text style={s.h4}>Distributions to Heirs (net)</Text>
              <View style={s.row}>
                <Text style={[s.cellL, s.th]}>Heir</Text>
                <Text style={[s.cell, s.th]}>Today · Outright</Text>
                <Text style={[s.cell, s.th]}>Today · In trust</Text>
                <Text style={[s.cell, s.th]}>EOL · Outright</Text>
                <Text style={[s.cell, s.th]}>EOL · In trust</Text>
              </View>
              {data.heirs.map((h) => (
                <View key={h.key} style={[s.row, s.hair]}>
                  <Text style={[s.cellL, s.td]}>{h.recipientLabel}</Text>
                  <Text style={[s.cell, s.td]}>{h.todayOutright > 0 ? fmtUsd(h.todayOutright) : "—"}</Text>
                  <Text style={[s.cell, s.td]}>{h.todayInTrust > 0 ? fmtUsd(h.todayInTrust) : "—"}</Text>
                  <Text style={[s.cell, s.td]}>{h.eolOutright > 0 ? fmtUsd(h.eolOutright) : "—"}</Text>
                  <Text style={[s.cell, s.td]}>{h.eolInTrust > 0 ? fmtUsd(h.eolInTrust) : "—"}</Text>
                </View>
              ))}
              <Text style={s.note}>
                {"\"Today\" = household dies now (after both deaths). \"End of Life\" = each spouse's projected death year. Surviving-spouse pass-through is excluded; amounts are net of taxes & costs."}
              </Text>
            </View>
          </View>

          {/* Narrative */}
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
