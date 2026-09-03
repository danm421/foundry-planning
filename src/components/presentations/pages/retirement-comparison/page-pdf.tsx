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
import { dataLight } from "@/brand";
import { OverlayBarsPdf } from "./chart-pdf";
import { MaxSpendChartPdf } from "./max-spend-chart-pdf";
import { ConfidenceRangeChartPdf } from "./confidence-range-chart-pdf";
import { TaxTreatmentChartPdf } from "./tax-treatment-chart-pdf";
import { MONO } from "./chart-axis";
import { KPI_BORDER, KPI_GAP, KPI_PAD } from "./kpi-geom";
import { horizonYearsLabel } from "@/lib/presentations/shared/horizon-label";
import { truncateLabel } from "@/lib/presentations/format";

const s = StyleSheet.create({
  verdict: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderLeftWidth: 3, borderLeftColor: T.good, borderRadius: 3, padding: 10, marginBottom: 10 },
  verdictText: { fontSize: 13, fontWeight: 700, color: T.ink, lineHeight: 1.3 },
  panel: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderRadius: 3, padding: 8, marginBottom: 8 },
  // Side-by-side variant of `panel`: equal-width columns inside `chartRow`
  // (the row owns the bottom margin so the columns drop it).
  panelCol: { flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderRadius: 3, padding: 8 },
  chartRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  h4: { fontSize: 8, color: T.ink2, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 },

  // Compact per-chart figure table that doubles as the chart's legend
  // (swatch · label · value). Shared by the max-spend and confidence charts.
  metricTable: { marginTop: 4 },
  metricRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 2.5, borderTopWidth: 0.5, borderTopColor: T.hair },
  metricKey: { flexDirection: "row", alignItems: "center" },
  metricSwatch: { width: 7, height: 7, borderRadius: 1.5, marginRight: 5 },
  metricLabel: { fontSize: 8, color: T.ink2 },
  metricVal: { fontSize: 9, fontWeight: 600, color: T.ink, fontFamily: MONO },

  // Gap, border and padding come from ./kpi-geom so the guard that measures a
  // real render derives the card boxes from the SAME numbers the page lays out
  // with; restating them here is how a guard starts measuring a page the
  // product never prints.
  kpiRow: { flexDirection: "row", gap: KPI_GAP, marginBottom: 10 },
  // space-between pins the value block to the card bottom so values align across 1- vs 2-line labels
  kpi: { flex: 1, justifyContent: "space-between", backgroundColor: T.card, borderWidth: KPI_BORDER, borderColor: T.hair2, borderRadius: 3, padding: KPI_PAD },
  kpiLbl: { fontSize: 6.5, color: T.ink2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, lineHeight: 1.2 },
  // wrap: at five cards a card is ~82pt wide, and a rate-valued pair
  // ("$170K/yr → $175K/yr") needs ~114pt. Without this the scenario value
  // overprints the arrow and runs past the card border into its neighbour.
  kpiVals: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", marginTop: 5 },
  kpiBase: { fontSize: 8, color: T.ink3, fontFamily: MONO },
  kpiArrow: { fontSize: 8, color: T.ink3, marginHorizontal: 3 },
  kpiScn: { fontSize: 13, fontWeight: 600, color: T.ink, fontFamily: MONO },
  // Colour comes from the card's `direction`, not from here — the delta used to
  // be unconditionally T.good, which printed a 17-point DROP in plan confidence
  // in the success colour.
  kpiDelta: { fontSize: 7.5, fontWeight: 600, marginTop: 3, fontFamily: MONO },

  note: { fontSize: 6.5, color: T.ink3, marginTop: 4, lineHeight: 1.3 },

  ai: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderLeftWidth: 3, borderLeftColor: T.accent, borderRadius: 3, padding: 8 },
  aiText: { fontSize: 8, color: T.ink, lineHeight: 1.35 },
  placeholder: { fontSize: 8, color: T.ink3, fontStyle: "italic" },
  empty: { fontSize: 11, color: T.ink2, textAlign: "center", marginTop: 60 },
});

function deltaColor(direction: 1 | -1 | 0): string {
  return direction === 1 ? T.good : direction === -1 ? T.crit : T.ink;
}

function KpiCardView({ card }: { card: KpiCard }) {
  return (
    <View style={s.kpi}>
      <Text style={s.kpiLbl}>{card.label}</Text>
      <View>
        <View style={s.kpiVals}>
          <Text style={s.kpiBase}>{card.base}</Text>
          <Text style={s.kpiArrow}>→</Text>
          <Text style={s.kpiScn}>{card.scenario}</Text>
        </View>
        {card.delta ? <Text style={[s.kpiDelta, { color: deltaColor(card.direction) }]}>{card.delta}</Text> : null}
      </View>
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

  // The two plans used to be the literal words "Current" and "Proposed", which
  // are false as soon as the advisor picks a scenario as the baseline — the
  // subtitle and every KPI on this sheet already name the real plans.
  //
  // Four surfaces print a name and each has its own width, so each gets its own
  // cap, MEASURED by rendering this sheet at candidate caps and reading the
  // result back with `pdftotext -bbox` (see the ledger). A name fails in one of
  // two ways depending on whether it contains a space: one WITH a space wraps
  // to a second line and pushes the page down; one without cannot wrap, so it
  // overruns its box and overprints its neighbour. Both were swept.
  //
  //   HEAD_CAP 20    the page-1 chart heading. Largest value that survives both
  //                  modes: an unbroken 22-char name wraps it.
  //   HORIZON_CAP 16 the "At retirement (…)" heading, which prints a year
  //                  beside each name and so has far less room than it looks.
  //                  A spaced name wraps it at 18 — but an UNBROKEN one wraps
  //                  it at 12, and 10 would truncate "Proposed Plan", an
  //                  entirely ordinary name, on most real decks. Set for real
  //                  names: a pathological 17+ char single token costs this
  //                  heading one extra line, which page 1 has the room to
  //                  absorb (verified by render). It only prints names at all
  //                  when the two plans retire in different years — see
  //                  horizon-label.ts.
  //   LEGEND_CAP 24  a chart legend row inside a ~246pt side-by-side panel; at
  //                  26 an unbroken name overprints the value beside it.
  //
  // The fourth surface, the SVG axis label inside TaxTreatmentChartPdf, is
  // capped there — it is the one that fails SILENTLY.
  const HEAD_CAP = 20;
  const HORIZON_CAP = 16;
  const LEGEND_CAP = 24;
  const headBase = truncateLabel(data.baselineLabel, HEAD_CAP);
  const headScn = truncateLabel(data.scenarioLabel, HEAD_CAP);
  const horizonBase = truncateLabel(data.baselineLabel, HORIZON_CAP);
  const horizonScn = truncateLabel(data.scenarioLabel, HORIZON_CAP);
  const legendBase = truncateLabel(data.baselineLabel, LEGEND_CAP);
  const legendScn = truncateLabel(data.scenarioLabel, LEGEND_CAP);

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
          <Text style={s.h4}>{`Portfolio assets over time — ${headScn} vs. ${headBase}`}</Text>
          <OverlayBarsPdf bars={data.overlay} retirementYear={data.atRetirement.scenarioYear} />
        </View>

        <View style={s.panel}>
          <Text style={s.h4}>{`At retirement (${horizonYearsLabel(data.atRetirement.baseYear, data.atRetirement.scenarioYear, horizonBase, horizonScn)}) — portfolio assets by tax treatment`}</Text>
          <TaxTreatmentChartPdf data={data.atRetirement} baselineLabel={data.baselineLabel} scenarioLabel={data.scenarioLabel} />
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
              <Text style={s.h4}>Maximum sustainable spending</Text>
              <MaxSpendChartPdf series={data.maxSpend.series} width={chartWidth} />
              <View style={s.metricTable}>
                <View style={s.metricRow}>
                  <View style={s.metricKey}>
                    <View style={[s.metricSwatch, { backgroundColor: dataLight.green }]} />
                    <Text style={s.metricLabel}>{legendScn}</Text>
                  </View>
                  <Text style={s.metricVal}>{`${fmtUsd(data.maxSpend.scenarioToday)}/yr`}</Text>
                </View>
                <View style={s.metricRow}>
                  <View style={s.metricKey}>
                    <View style={[s.metricSwatch, { backgroundColor: dataLight.grey }]} />
                    <Text style={s.metricLabel}>{legendBase}</Text>
                  </View>
                  <Text style={s.metricVal}>{`${fmtUsd(data.maxSpend.baseToday)}/yr`}</Text>
                </View>
              </View>
              {/* The rows and the lines are the SAME spending on two bases. The
                  title used to claim today's $ while the chart plotted future
                  $ and the rows printed today's $ — three bases, one panel. */}
              <Text style={s.note}>
                Rows are in today&apos;s dollars; the lines show that same spending inflated to each year.
              </Text>
            </View>
          ) : null;

          // Safe: data.confidence.show is only true when points.length > 0.
          const lastConf = data.confidence.points[data.confidence.points.length - 1];
          const confidencePanel = data.confidence.show ? (
            <View style={panelStyle}>
              <Text style={s.h4}>Range of outcomes — downside protection</Text>
              <ConfidenceRangeChartPdf points={data.confidence.points} width={chartWidth} />
              <View style={s.metricTable}>
                <View style={s.metricRow}>
                  <View style={s.metricKey}>
                    <View style={[s.metricSwatch, { backgroundColor: dataLight.green }]} />
                    <Text style={s.metricLabel}>{legendScn}</Text>
                  </View>
                  <Text style={s.metricVal}>{`${fmtUsd(lastConf.scnP20)}`}</Text>
                </View>
                <View style={s.metricRow}>
                  <View style={s.metricKey}>
                    <View style={[s.metricSwatch, { backgroundColor: dataLight.grey }]} />
                    <Text style={s.metricLabel}>{legendBase}</Text>
                  </View>
                  <Text style={s.metricVal}>{`${fmtUsd(lastConf.baseP20)}`}</Text>
                </View>
              </View>
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
            <Text style={s.h4}>{`At end of life (${horizonYearsLabel(data.atEndOfLife.baseYear, data.atEndOfLife.scenarioYear, horizonBase, horizonScn)}) — portfolio assets by tax treatment`}</Text>
            <TaxTreatmentChartPdf data={data.atEndOfLife} baselineLabel={data.baselineLabel} scenarioLabel={data.scenarioLabel} compact />
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
