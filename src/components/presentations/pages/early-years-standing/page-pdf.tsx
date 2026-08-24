import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { TidbitSidebarPdf } from "@/components/presentations/shared/tidbit-sidebar-pdf";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { exactCurrency, percentLabel } from "@/lib/presentations/format";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { EarlyYearsStandingPageData } from "@/lib/presentations/pages/early-years-standing/types";

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 8, color: T.ink2, marginBottom: 22 },
  content: { flex: 1, justifyContent: "space-between", paddingBottom: 20 },
  heroRow: { flexDirection: "row", gap: 14, minHeight: 145 },
  main: { flex: 1 },
  heroLbl: { fontSize: 8, color: T.ink2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6 },
  // Ink, never the section accent: the accent marks the sheet, not the datum.
  heroVal: { fontSize: 64, fontWeight: 700, color: T.ink, lineHeight: 1 },
  heroSub: { fontSize: 12, color: T.ink2, lineHeight: 1.35, marginTop: 7 },
  kpis: { flexDirection: "row", gap: 12, marginTop: 28 },
  kpi: { flex: 1, justifyContent: "space-between", backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderRadius: 3, padding: 14, minHeight: 82 },
  kpiLbl: { fontSize: 8, color: T.ink2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.55 },
  kpiVal: { fontSize: 21, fontWeight: 700, marginTop: 8 },
  match: { justifyContent: "center", backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderLeftWidth: 3, borderRadius: 3, padding: 15, marginTop: 20, minHeight: 62 },
  matchText: { fontSize: 11.5, color: T.ink, lineHeight: 1.4 },
  unitProof: { justifyContent: "center", borderWidth: 1, borderColor: T.hair2, borderLeftWidth: 3, borderRadius: 3, padding: 18, minHeight: 120 },
  unitProofLabel: { fontSize: 8, color: T.ink2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6 },
  unitProofValue: { fontSize: 19, color: T.ink, fontWeight: 700, marginTop: 9 },
  unitProofText: { fontSize: 10.5, color: T.ink2, lineHeight: 1.4, marginTop: 8 },
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

export function EarlyYearsStandingPagePdf(input: RenderPdfInput<EarlyYearsStandingPageData>) {
  const { data, firmName, clientName, reportDate, pageIndex, totalPages, accent } = input;
  const frame = { firmName, clientName, reportDate, pageIndex, totalPages };

  if (data.isEmpty) {
    return (
      <PageFrame {...frame}>
        <Text style={s.title}>Where You Stand Today</Text>
        <Text style={s.empty}>
          This page states savings as a share of salary. The plan has no salary income in
          its first year, so there is no rate to show.
        </Text>
      </PageFrame>
    );
  }

  return (
    <PageFrame {...frame}>
      <Text style={s.title}>Where You Stand Today</Text>
      <Text style={s.subtitle}>{data.subtitle}</Text>

      <View style={s.content}>
        <View>
          <View style={s.heroRow}>
            <View style={s.main}>
              <Text style={s.heroLbl}>Your savings rate</Text>
              <Text style={s.heroVal}>{`${Math.round(data.savingsRatePct * 100)}%`}</Text>
              <Text style={s.heroSub}>
                {`${exactCurrency(data.contributionsAnnual.today)} of the ${exactCurrency(data.grossAnnual.today)} you earn goes into savings each year.`}
              </Text>
            </View>

            <TidbitSidebarPdf tidbits={data.tidbits} accent={accent.accent} />
          </View>

          <View style={s.kpis}>
            <Kpi lbl="Salary income" val={exactCurrency(data.grossAnnual.today)} />
            <Kpi lbl="You contribute" val={exactCurrency(data.contributionsAnnual.today)} />
            <Kpi lbl="Invested portfolio" val={exactCurrency(data.portfolio.today)} />
          </View>

          {data.match.kind === "captured" && (
            <View style={[s.match, { borderLeftColor: accent.accent }]}>
              <Text style={s.matchText}>
                {`Your employer adds ${exactCurrency(data.match.employerAnnual.today)} a year on top of what you put in.`}
              </Text>
            </View>
          )}
        </View>

        <View
          style={[
            s.unitProof,
            { backgroundColor: accent.tint, borderLeftColor: accent.accent },
          ]}
        >
          <Text style={s.unitProofLabel}>How to read the dollars</Text>
          <Text style={s.unitProofValue}>Every figure is in today&apos;s dollars</Text>
          <Text style={s.unitProofText}>
            {`A dollar decades from now buys less than a dollar does at ${data.basis.planStartYear} prices, so every amount in this report is restated in what it would buy today. Where a later page prints a second figure in smaller type beneath a number, that is the same amount in the year it actually happens. The two are converted at this plan's inflation assumption of ${percentLabel(data.basis.inflationRate)} a year.`}
          </Text>
        </View>
      </View>
    </PageFrame>
  );
}
