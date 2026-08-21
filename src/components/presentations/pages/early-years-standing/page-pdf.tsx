import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { TidbitSidebarPdf } from "@/components/presentations/shared/tidbit-sidebar-pdf";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { exactCurrency } from "@/lib/presentations/format";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { EarlyYearsStandingPageData } from "@/lib/presentations/pages/early-years-standing/types";

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 8, color: T.ink2, marginBottom: 18 },
  cols: { flexDirection: "row", gap: 14 },
  main: { flex: 1 },
  heroLbl: { fontSize: 8, color: T.ink2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6 },
  // Ink, never the section accent: the accent marks the sheet, not the datum.
  heroVal: { fontSize: 56, fontWeight: 700, color: T.ink, lineHeight: 1 },
  heroSub: { fontSize: 11, color: T.ink2, lineHeight: 1.35, marginTop: 5 },
  kpis: { flexDirection: "row", gap: 9, marginTop: 20 },
  kpi: { flex: 1, justifyContent: "space-between", backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderRadius: 3, padding: 11, minHeight: 57 },
  kpiLbl: { fontSize: 7.5, color: T.ink2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 },
  kpiVal: { fontSize: 18, fontWeight: 700, marginTop: 6 },
  match: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderLeftWidth: 3, borderRadius: 3, padding: 12, marginTop: 16 },
  matchText: { fontSize: 10.5, color: T.ink, lineHeight: 1.4 },
  unitProof: { borderTopWidth: 1, borderTopColor: T.hair, marginTop: 28, paddingTop: 17 },
  unitProofLabel: { fontSize: 7.5, color: T.ink2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6 },
  unitProofText: { fontSize: 10, color: T.ink2, lineHeight: 1.4, marginTop: 6 },
  unitProofValue: { fontSize: 15, color: T.ink, fontWeight: 700, marginTop: 9 },
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

      <View style={s.cols}>
        <View style={s.main}>
          <Text style={s.heroLbl}>Your savings rate</Text>
          <Text style={s.heroVal}>{`${Math.round(data.savingsRatePct * 100)}%`}</Text>
          <Text style={s.heroSub}>
            {`${exactCurrency(data.contributionsAnnual.today)} of the ${exactCurrency(data.grossAnnual.today)} you earn goes into savings each year.`}
          </Text>

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

          <View style={s.unitProof}>
            <Text style={s.unitProofLabel}>One number, two views</Text>
            <Text style={s.unitProofText}>
              Because this is the plan&apos;s starting year, inflation has not separated the
              values yet.
            </Text>
            <Text style={s.unitProofValue}>
              {`${exactCurrency(data.portfolio.today)} today = ${exactCurrency(data.portfolio.nominal)} future-year dollars`}
            </Text>
          </View>
        </View>

        <TidbitSidebarPdf tidbits={data.tidbits} accent={accent.accent} />
      </View>
    </PageFrame>
  );
}
