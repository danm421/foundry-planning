import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { TidbitSidebarPdf } from "@/components/presentations/shared/tidbit-sidebar-pdf";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { exactCurrency } from "@/lib/presentations/format";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { EarlyYearsStandingPageData } from "@/lib/presentations/pages/early-years-standing/types";

const s = StyleSheet.create({
  title: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 8, color: T.ink2, marginBottom: 12 },
  cols: { flexDirection: "row", gap: 14 },
  main: { flex: 1 },
  heroLbl: { fontSize: 7, color: T.ink2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5 },
  // Ink, never the section accent: the accent marks the sheet, not the datum.
  heroVal: { fontSize: 40, fontWeight: 700, color: T.ink, lineHeight: 1.1 },
  heroSub: { fontSize: 9, color: T.ink2, marginTop: 2 },
  kpis: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 14 },
  kpi: { flexBasis: "31%", justifyContent: "space-between", backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderRadius: 3, padding: 6 },
  kpiLbl: { fontSize: 6.5, color: T.ink2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 },
  kpiVal: { fontSize: 14, fontWeight: 700, marginTop: 2 },
  match: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderLeftWidth: 3, borderRadius: 3, padding: 8, marginTop: 12 },
  matchText: { fontSize: 9, color: T.ink, lineHeight: 1.35 },
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
            {`${exactCurrency(data.contributionsAnnual)} of the ${exactCurrency(data.grossAnnual)} you earn goes into savings each year.`}
          </Text>

          <View style={s.kpis}>
            <Kpi lbl="Salary income" val={exactCurrency(data.grossAnnual)} />
            <Kpi lbl="You contribute" val={exactCurrency(data.contributionsAnnual)} />
            <Kpi lbl="Portfolio today" val={exactCurrency(data.portfolioToday)} />
          </View>

          {data.match.kind === "captured" && (
            <View style={[s.match, { borderLeftColor: accent.accent }]}>
              <Text style={s.matchText}>
                {`Your employer adds ${exactCurrency(data.match.employerAnnual)} a year on top of what you put in.`}
              </Text>
            </View>
          )}
        </View>

        <TidbitSidebarPdf tidbits={data.tidbits} accent={accent.accent} />
      </View>
    </PageFrame>
  );
}
