// src/components/presentations/pages/life-insurance-summary/page-pdf.tsx
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type {
  LifeInsuranceSummaryPageData,
  DecedentGap,
} from "@/lib/presentations/pages/life-insurance-summary/view-model";
import { fmtUsd } from "@/lib/presentations/pages/life-insurance-summary/aggregate";
import { LiPolicyTablePdf } from "./table-pdf";
import { LiNeedChartPdf } from "./chart-pdf";

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 8, color: T.ink2, marginBottom: 6 },
  kpis: { flexDirection: "row", gap: 8, marginBottom: 8 },
  kpi: { flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderRadius: 3, padding: 6 },
  kpiLbl: { fontSize: 6.5, color: T.ink2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 },
  kpiVal: { fontSize: 15, fontWeight: 700, marginTop: 2 },
  panel: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderRadius: 3, padding: 10, marginBottom: 8 },
  h4: { fontSize: 8, color: T.ink2, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 },
  benRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: T.hair2 },
  benName: { fontSize: 8, color: T.ink },
  benMeta: { fontSize: 7, color: T.ink3 },
  benPolicy: { fontSize: 8, fontWeight: 700, color: T.ink, marginTop: 5, marginBottom: 1 },
  gapWrap: { flexDirection: "row", gap: 8 },
  gapCol: { flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderRadius: 3, padding: 8 },
  gapTitle: { fontSize: 9, fontWeight: 700, marginBottom: 4 },
  barLbl: { fontSize: 6.5, color: T.ink2, marginTop: 3 },
  barTrack: { height: 8, backgroundColor: T.paper, borderRadius: 2, marginTop: 1, overflow: "hidden" },
  barHave: { height: 8, backgroundColor: T.steel },
  barNeed: { height: 8, backgroundColor: T.accent },
  gapResult: { fontSize: 9, fontWeight: 700, marginTop: 5 },
  narr: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderLeftWidth: 3, borderLeftColor: T.accent, borderRadius: 3, padding: 7, marginTop: 4 },
  narrText: { fontSize: 8, color: T.ink, lineHeight: 1.35, marginBottom: 1.5 },
  note: { fontSize: 6.5, color: T.ink3, marginTop: 4 },
  empty: { fontSize: 11, color: T.ink2, textAlign: "center", marginTop: 80 },
  legend: { flexDirection: "row", gap: 12, marginTop: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 3 },
  swatch: { width: 7, height: 7, borderRadius: 1 },
  legendTxt: { fontSize: 6.5, color: T.ink2 },
});

function Kpi({ lbl, val }: { lbl: string; val: string }) {
  return (
    <View style={s.kpi}>
      <Text style={s.kpiLbl}>{lbl}</Text>
      <Text style={s.kpiVal}>{val}</Text>
    </View>
  );
}

function gapColor(g: DecedentGap): string {
  if (g.exceedsCap || g.gap.kind === "shortfall") return T.crit;
  return T.good;
}
function gapText(g: DecedentGap): string {
  if (g.exceedsCap) return "Need exceeds $20M";
  if (g.gap.kind === "shortfall") return `Shortfall ${fmtUsd(g.gap.amount)}`;
  if (g.gap.kind === "surplus") return `Surplus ${fmtUsd(g.gap.amount)}`;
  return "Coverage meets need";
}

function GapPanel({ g, markYear }: { g: DecedentGap; markYear: number | null }) {
  const need = Math.max(1, g.need);
  const havePct = Math.min(100, (g.have / need) * 100);
  return (
    <View style={s.gapCol}>
      <Text style={s.gapTitle}>{`If ${g.decedentLabel} dies${markYear ? ` (${markYear})` : ""}`}</Text>
      <Text style={s.barLbl}>{`Have ${fmtUsd(g.have)}`}</Text>
      <View style={s.barTrack}><View style={[s.barHave, { width: `${havePct}%` }]} /></View>
      <Text style={s.barLbl}>{`Need ${fmtUsd(g.need)}`}</Text>
      <View style={s.barTrack}><View style={[s.barNeed, { width: "100%" }]} /></View>
      <Text style={[s.gapResult, { color: gapColor(g) }]}>{gapText(g)}</Text>
    </View>
  );
}

export function LifeInsuranceSummaryPagePdf(
  input: RenderPdfInput<LifeInsuranceSummaryPageData>,
) {
  const { data, firmName, clientName, reportDate, pageIndex, totalPages } = input;

  if (data.isEmpty) {
    return (
      <PageFrame firmName={firmName} clientName={clientName} reportDate={reportDate} pageIndex={pageIndex} totalPages={totalPages} orientation="portrait">
        <Text style={s.title}>{data.title}</Text>
        <Text style={s.empty}>No life insurance data available for this scenario.</Text>
      </PageFrame>
    );
  }

  return (
    <>
      {/* ── Page 1 — Inventory ── */}
      <PageFrame firmName={firmName} clientName={clientName} reportDate={reportDate} pageIndex={pageIndex} totalPages={totalPages} orientation="portrait">
        <Text style={s.title}>{data.title}</Text>
        <Text style={s.subtitle}>{data.subtitle}</Text>

        <View style={s.kpis}>
          <Kpi lbl="Policies" val={String(data.totals.count)} />
          <Kpi lbl="In-force death benefit" val={fmtUsd(data.totals.deathBenefit)} />
          <Kpi lbl="Cash value" val={fmtUsd(data.totals.cashValue)} />
          <Kpi lbl="Annual premium" val={fmtUsd(data.totals.premium)} />
        </View>

        {data.policies.length > 0 ? (
          <>
            <View style={s.panel}>
              <Text style={s.h4}>All policies</Text>
              <LiPolicyTablePdf policies={data.policies} />
              {data.jointFootnote ? (
                <Text style={s.note}>Joint-life policies are listed but excluded from per-life coverage totals on page 2.</Text>
              ) : null}
            </View>

            <View style={s.panel}>
              <Text style={s.h4}>Beneficiaries</Text>
              {data.policies.map((p) => (
                <View key={p.accountId} wrap={false}>
                  <Text style={s.benPolicy}>{p.name}</Text>
                  {p.beneficiaries.length === 0 ? (
                    <Text style={s.benMeta}>No beneficiaries on file.</Text>
                  ) : (
                    p.beneficiaries.map((b, i) => (
                      <View style={s.benRow} key={`${p.accountId}-${i}`}>
                        <Text style={s.benName}>{`${b.name}`}</Text>
                        <Text style={s.benMeta}>{`${b.tier === "primary" ? "Primary" : "Contingent"} · ${Math.round(b.percentage)}%`}</Text>
                      </View>
                    ))
                  )}
                </View>
              ))}
            </View>
          </>
        ) : (
          <View style={s.panel}><Text style={s.note}>No in-force life insurance policies on file.</Text></View>
        )}

        <View style={s.narr}>
          {data.narrative.map((line, i) => (
            <Text key={i} style={s.narrText}>{i === 0 ? <Text style={{ fontWeight: 700 }}>Takeaways. </Text> : null}{line}</Text>
          ))}
        </View>
      </PageFrame>

      {/* ── Page 2 — Coverage vs need ── */}
      <PageFrame firmName={firmName} clientName={clientName} reportDate={reportDate} pageIndex={pageIndex + 1} totalPages={totalPages} orientation="portrait">
        <Text style={s.title}>Coverage vs. need</Text>
        <Text style={s.subtitle}>{data.subtitle}</Text>

        {data.notSolved ? (
          <View style={s.panel}>
            <Text style={s.note}>Run the life insurance solver, then regenerate to populate coverage-vs-need and the need-over-time chart.</Text>
          </View>
        ) : (
          <>
            <View style={s.gapWrap}>
              {data.clientGap ? <GapPanel g={data.clientGap} markYear={data.chart.markYear} /> : null}
              {data.spouseGap ? <GapPanel g={data.spouseGap} markYear={data.chart.markYear} /> : null}
            </View>

            <View style={[s.panel, { marginTop: 8 }]}>
              <Text style={s.h4}>Life insurance need over time</Text>
              <LiNeedChartPdf chart={data.chart} married={data.married} />
              <View style={s.legend}>
                <View style={s.legendItem}><View style={[s.swatch, { backgroundColor: T.steel }]} /><Text style={s.legendTxt}>Client need</Text></View>
                {data.married ? <View style={s.legendItem}><View style={[s.swatch, { backgroundColor: T.ink3 }]} /><Text style={s.legendTxt}>Spouse need</Text></View> : null}
                <View style={s.legendItem}><View style={[s.swatch, { backgroundColor: T.accent }]} /><Text style={s.legendTxt}>MC solve year</Text></View>
                <View style={s.legendItem}><View style={[s.swatch, { backgroundColor: T.crit }]} /><Text style={s.legendTxt}>Current coverage</Text></View>
              </View>
            </View>
          </>
        )}

        <View style={s.narr}>
          {data.narrative.map((line, i) => (
            <Text key={i} style={s.narrText}>{i === 0 ? <Text style={{ fontWeight: 700 }}>Takeaways. </Text> : null}{line}</Text>
          ))}
        </View>
      </PageFrame>
    </>
  );
}
