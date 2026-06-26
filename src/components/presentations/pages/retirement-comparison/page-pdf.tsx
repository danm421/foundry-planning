import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { Fragment } from "react";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { SectionHead } from "@/components/presentations/shared/section-head";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type {
  RetirementComparisonPageData,
  KpiCard,
} from "@/lib/presentations/pages/retirement-comparison/types";
import { fmtUsdCompact as fmtUsd } from "@/lib/presentations/pages/retirement-comparison/format";
import { OverlayBarsPdf } from "./chart-pdf";
import { MaxSpendChartPdf } from "./max-spend-chart-pdf";
import { ConfidenceRangeChartPdf } from "./confidence-range-chart-pdf";
import { TaxTreatmentChartPdf } from "./tax-treatment-chart-pdf";
import { MONO } from "./chart-axis";

const s = StyleSheet.create({
  verdict: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair, borderLeftWidth: 3, borderLeftColor: T.good, borderRadius: 3, padding: 10, marginBottom: 10 },
  verdictText: { fontSize: 13, fontWeight: 700, color: T.ink, lineHeight: 1.3 },
  panel: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair, borderRadius: 3, padding: 8, marginBottom: 8 },
  // Side-by-side variant of `panel`: equal-width columns inside `chartRow`
  // (the row owns the bottom margin so the columns drop it).
  panelCol: { flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.hair, borderRadius: 3, padding: 8 },
  chartRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  h4: { fontSize: 8, color: T.ink2, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 },

  kpiRow: { flexDirection: "row", gap: 6, marginBottom: 10 },
  kpi: { flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.hair, borderRadius: 3, padding: 8 },
  kpiLbl: { fontSize: 6.5, color: T.ink2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, lineHeight: 1.2 },
  kpiVals: { flexDirection: "row", alignItems: "baseline", marginTop: 5 },
  kpiBase: { fontSize: 8, color: T.ink3, fontFamily: MONO },
  kpiArrow: { fontSize: 8, color: T.ink3, marginHorizontal: 3 },
  kpiScn: { fontSize: 13, fontWeight: 600, color: T.ink, fontFamily: MONO },
  kpiDelta: { fontSize: 7.5, fontWeight: 600, color: T.good, marginTop: 3, fontFamily: MONO },

  ai: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair, borderLeftWidth: 3, borderLeftColor: T.accent, borderRadius: 3, padding: 8 },
  aiText: { fontSize: 8, color: T.ink, lineHeight: 1.35 },
  placeholder: { fontSize: 8, color: T.ink3, fontStyle: "italic" },
  empty: { fontSize: 11, color: T.ink2, textAlign: "center", marginTop: 60 },
});

function KpiCardView({ card }: { card: KpiCard }) {
  return (
    <View style={s.kpi}>
      <Text style={s.kpiLbl}>{card.label}</Text>
      <View style={s.kpiVals}>
        <Text style={s.kpiBase}>{card.base}</Text>
        <Text style={s.kpiArrow}>→</Text>
        <Text style={s.kpiScn}>{card.scenario}</Text>
      </View>
      {card.delta ? <Text style={s.kpiDelta}>{card.delta}</Text> : null}
    </View>
  );
}

export function RetirementComparisonPagePdf(input: RenderPdfInput<RetirementComparisonPageData>) {
  const { data, firmName, clientName, reportDate, pageIndex, totalPages, accent } = input;

  if (data.isEmpty) {
    return (
      <PageFrame firmName={firmName} clientName={clientName} reportDate={reportDate} pageIndex={pageIndex} totalPages={totalPages}>
        <SectionHead title={data.title} eyebrow="RETIREMENT COMPARISON" accent={accent} />
        <Text style={s.empty}>Select a comparison scenario to populate this page.</Text>
      </PageFrame>
    );
  }

  const kpis = data.kpis.filter((k) => k.show);

  return (
    <Fragment>
      {/* ── Page 1 · The outcome ── */}
      <PageFrame firmName={firmName} clientName={clientName} reportDate={reportDate} pageIndex={pageIndex} totalPages={totalPages}>
        <SectionHead title={data.title} subtitle={data.subtitle} eyebrow="RETIREMENT COMPARISON" accent={accent} />

        <View style={s.verdict}>
          <Text style={s.verdictText}>{data.verdict.headline}</Text>
        </View>

        {kpis.length > 0 ? (
          <View style={s.kpiRow}>
            {kpis.map((c) => <KpiCardView key={c.label} card={c} />)}
          </View>
        ) : null}

        <View style={s.panel}>
          <Text style={s.h4}>Portfolio assets over time — proposed vs. current</Text>
          <OverlayBarsPdf bars={data.overlay} retirementYear={data.atRetirement.year} />
        </View>

        <View style={s.panel}>
          <Text style={s.h4}>{`At retirement (${data.atRetirement.year}) — portfolio assets by tax treatment`}</Text>
          <TaxTreatmentChartPdf data={data.atRetirement} />
        </View>
      </PageFrame>

      {/* ── Page 2 · The detail ── */}
      <PageFrame firmName={firmName} clientName={clientName} reportDate={reportDate} pageIndex={pageIndex + 1} totalPages={totalPages}>
        <SectionHead title="Retirement Comparison — detail" eyebrow="RETIREMENT COMPARISON" accent={accent} />

        {(() => {
          const bothCharts = data.maxSpend.show && data.confidence.show;
          // Side-by-side halves the available width; full-width when solo.
          const chartWidth = bothCharts ? 240 : 500;
          const panelStyle = bothCharts ? s.panelCol : s.panel;

          const maxSpendPanel = data.maxSpend.show ? (
            <View style={panelStyle}>
              <Text style={s.h4}>{`Maximum sustainable spending — ${fmtUsd(data.maxSpend.scenarioToday)}/yr proposed vs. ${fmtUsd(data.maxSpend.baseToday)}/yr current (today's $)`}</Text>
              <MaxSpendChartPdf series={data.maxSpend.series} width={chartWidth} />
            </View>
          ) : null;

          const confidencePanel = data.confidence.show ? (
            <View style={panelStyle}>
              <Text style={s.h4}>Range of outcomes — downside protection</Text>
              <ConfidenceRangeChartPdf points={data.confidence.points} width={chartWidth} />
            </View>
          ) : null;

          return bothCharts ? (
            <View style={s.chartRow}>
              {maxSpendPanel}
              {confidencePanel}
            </View>
          ) : (
            <Fragment>
              {maxSpendPanel}
              {confidencePanel}
            </Fragment>
          );
        })()}

        {data.showPortfolioMatrix ? (
          <View style={s.panel}>
            <Text style={s.h4}>{`At end of life (${data.atEndOfLife.year}) — portfolio assets by tax treatment`}</Text>
            <TaxTreatmentChartPdf data={data.atEndOfLife} compact />
          </View>
        ) : null}

        {data.showAiSummary ? (
          <View style={s.ai}>
            <Text style={s.h4}>Summary</Text>
            {data.aiMarkdown.trim().length > 0 ? (
              <Text style={s.aiText}>{data.aiMarkdown}</Text>
            ) : (
              <Text style={s.placeholder}>AI summary not generated yet — use the page options to generate it.</Text>
            )}
          </View>
        ) : null}
      </PageFrame>
    </Fragment>
  );
}
