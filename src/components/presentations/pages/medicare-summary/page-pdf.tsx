import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { MedicareSummaryPageData } from "@/lib/presentations/pages/medicare-summary/view-model";
import { fmtUsd, fmtPct } from "@/lib/presentations/pages/medicare-summary/aggregate";
import { MedicareSummaryChartPdf } from "./chart-pdf";

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 8, color: T.ink2, marginBottom: 6 },
  kpis: { flexDirection: "row", gap: 8, marginBottom: 8 },
  kpi: { flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.hair, borderRadius: 3, padding: 6 },
  kpiLbl: { fontSize: 6.5, color: T.ink2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 },
  kpiVal: { fontSize: 14, fontWeight: 700, marginTop: 2 },
  body: { flexDirection: "row", gap: 10 },
  panel: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair, borderRadius: 3, padding: 10 },
  panelLeft: { flexBasis: "56%" },
  panelRight: { flexBasis: "44%" },
  h4: { fontSize: 8, color: T.ink2, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 },
  // composition split bar + table
  splitTrack: { flexDirection: "row", height: 16, borderRadius: 2, overflow: "hidden", marginTop: 6, marginBottom: 4 },
  swatch: { width: 6, height: 6, marginRight: 4 },
  compTable: { marginTop: 2 },
  compRow: { flexDirection: "row", alignItems: "center", paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: T.hair },
  compLabelCell: { flexDirection: "row", alignItems: "center", flex: 1 },
  compLabel: { fontSize: 8, color: T.ink },
  compPct: { fontSize: 8, color: T.ink2, width: 36, textAlign: "right" },
  compAmt: { fontSize: 9, fontWeight: 700, color: T.ink, width: 56, textAlign: "right" },
  compTotalRow: { flexDirection: "row", alignItems: "center", paddingTop: 3, marginTop: 1, borderTopWidth: 1, borderTopColor: T.hair },
  compTotalLabel: { fontSize: 8, fontWeight: 700, color: T.ink, flex: 1 },
  compTotalAmt: { fontSize: 9, fontWeight: 700, color: T.ink, width: 56, textAlign: "right" },
  // tier ladder
  ladder: { marginTop: 10 },
  ladderRow: { flexDirection: "row", alignItems: "center", paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: T.hair },
  ladderTier: { fontSize: 8, fontWeight: 700, color: T.ink, width: 40 },
  ladderThresh: { fontSize: 8, color: T.ink2, flex: 1 },
  ladderYears: { fontSize: 8, color: T.ink, width: 50, textAlign: "right" },
  headroomNote: { fontSize: 7, color: T.ink2, marginTop: 4 },
  narr: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair, borderLeftWidth: 3, borderLeftColor: T.accent, borderRadius: 3, padding: 7, marginTop: 6 },
  narrText: { fontSize: 8, color: T.ink, lineHeight: 1.35, marginBottom: 1.5 },
  disclaimer: { fontSize: 6, color: T.ink3, marginTop: 6 },
  empty: { fontSize: 11, color: T.ink2, textAlign: "center", marginTop: 60 },
});

const COMP_SEGMENTS = [
  { key: "partB" as const, label: "Part B", color: T.steel },
  { key: "partD" as const, label: "Part D", color: T.accent },
  { key: "medigap" as const, label: "Medigap", color: T.good },
  { key: "irmaa" as const, label: "IRMAA", color: T.crit },
];

const DISCLAIMER =
  "Medicare premiums and IRMAA use CMS current-year amounts inflated forward; thresholds are CPI-indexed and reflect MAGI from two years prior. Excludes IRMAA appeals (life-changing events), Medicaid interactions, and Part D formulary effects. Actual costs vary by plan and CMS rule changes.";

function Kpi({ lbl, val }: { lbl: string; val: string }) {
  return (
    <View style={s.kpi}>
      <Text style={s.kpiLbl}>{lbl}</Text>
      <Text style={s.kpiVal}>{val}</Text>
    </View>
  );
}

export function MedicareSummaryPagePdf(input: RenderPdfInput<MedicareSummaryPageData>) {
  const { data, firmName, clientName, reportDate, pageIndex, totalPages } = input;
  return (
    <PageFrame firmName={firmName} clientName={clientName} reportDate={reportDate} pageIndex={pageIndex} totalPages={totalPages} orientation="landscape">
      <Text style={s.title}>{data.title}</Text>
      <Text style={s.subtitle}>{data.subtitle}</Text>

      {data.isEmpty ? (
        <Text style={s.empty}>Household does not reach Medicare eligibility within this plan.</Text>
      ) : (
        <>
          <View style={s.kpis}>
            <Kpi lbl="Lifetime Medicare Cost" val={fmtUsd(data.kpis.lifetimeMedicareCost)} />
            <Kpi lbl="Lifetime IRMAA Surcharge" val={fmtUsd(data.kpis.lifetimeIrmaa)} />
            <Kpi lbl="IRMAA Share of Medicare" val={fmtPct(data.kpis.irmaaShare)} />
            <Kpi lbl="Years in IRMAA" val={`${data.kpis.irmaaYears} of ${data.kpis.enrolledYears}`} />
            <Kpi lbl="Peak IRMAA Tier" val={data.kpis.peakTierYear != null ? `Tier ${data.kpis.peakTier} · ${data.kpis.peakTierYear}` : "None"} />
          </View>

          <View style={s.body}>
            <View style={[s.panel, s.panelLeft]}>
              <Text style={s.h4}>Annual Medicare cost — base premiums vs. IRMAA</Text>
              <MedicareSummaryChartPdf bars={data.bars} />
            </View>

            <View style={[s.panel, s.panelRight]}>
              <Text style={s.h4}>Where the money goes (lifetime)</Text>
              <View style={s.splitTrack}>
                {COMP_SEGMENTS.map((seg) => {
                  const v = data.composition[seg.key];
                  const pct = data.composition.total > 0 ? (v / data.composition.total) * 100 : 0;
                  if (pct <= 0) return null;
                  return <View key={seg.key} style={{ width: `${pct}%`, backgroundColor: seg.color }} />;
                })}
              </View>
              <View style={s.compTable}>
                {COMP_SEGMENTS.map((seg) => {
                  const v = data.composition[seg.key];
                  const pct = data.composition.total > 0 ? (v / data.composition.total) * 100 : 0;
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

              <View style={s.ladder}>
                <Text style={s.h4}>IRMAA tier exposure</Text>
                {data.tierLadder.map((row) => (
                  <View key={row.tier} style={s.ladderRow}>
                    <Text style={s.ladderTier}>{`Tier ${row.tier}`}</Text>
                    <Text style={s.ladderThresh}>{row.thresholdLabel ?? "—"}</Text>
                    <Text style={s.ladderYears}>{`${row.years} yr${row.years === 1 ? "" : "s"}`}</Text>
                  </View>
                ))}
                {data.headroom ? (
                  <Text style={s.headroomNote}>
                    {`In ${data.headroom.year}, ${fmtUsd(data.headroom.amount)} under the Tier ${data.headroom.nextTier} threshold.`}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>

          <View style={s.narr}>
            {data.narrative.map((line, i) => (
              <Text key={i} style={s.narrText}>{i === 0 ? "Takeaways. " : ""}{line}</Text>
            ))}
          </View>

          <Text style={s.disclaimer}>{DISCLAIMER}</Text>
        </>
      )}
    </PageFrame>
  );
}
