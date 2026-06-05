import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { Fragment } from "react";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { SectionHead } from "@/components/presentations/shared/section-head";
import { PRESENTATION_THEME as T, ZEBRA_FILL } from "@/lib/presentations/theme";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type {
  RetirementComparisonPageData,
  PortfolioMatrixCell,
  StatCard,
} from "@/lib/presentations/pages/retirement-comparison/types";
import { fmtUsdCompact as fmtUsd } from "@/lib/presentations/pages/retirement-comparison/format";
import { OverlayBarsPdf } from "./chart-pdf";
import { MaxSpendChartPdf } from "./max-spend-chart-pdf";
import { ConfidenceRangeChartPdf } from "./confidence-range-chart-pdf";

const s = StyleSheet.create({
  verdict: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair, borderLeftWidth: 3, borderLeftColor: T.good, borderRadius: 3, padding: 10, marginBottom: 10 },
  verdictText: { fontSize: 13, fontWeight: 700, color: T.ink, lineHeight: 1.3 },
  panel: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair, borderRadius: 3, padding: 8, marginBottom: 6 },
  h4: { fontSize: 8, color: T.ink2, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 },
  cards: { flexDirection: "row", gap: 6, marginTop: 2 },
  card: { flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.hair, borderRadius: 3, padding: 8 },
  cardLbl: { fontSize: 6.5, color: T.ink2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 },
  cardVals: { flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 3 },
  cardBase: { fontSize: 8, color: T.ink3 },
  cardArrow: { fontSize: 8, color: T.ink3 },
  cardScn: { fontSize: 13, fontWeight: 700, color: T.ink },
  cardDelta: { fontSize: 7.5, fontWeight: 700, color: T.good, marginTop: 2 },
  twoCol: { flexDirection: "row", gap: 8 },
  mRow: { flexDirection: "row", paddingVertical: 2.5, paddingHorizontal: 3 },
  mHead: { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 3, borderBottomWidth: 1, borderBottomColor: T.hair },
  mCellLbl: { flex: 1.2, fontSize: 7, color: T.ink },
  mCell: { flex: 1, fontSize: 7.5, color: T.ink, textAlign: "right" },
  mTh: { fontSize: 6, color: T.ink3, fontWeight: 700, textTransform: "uppercase" },
  ai: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair, borderLeftWidth: 3, borderLeftColor: T.accent, borderRadius: 3, padding: 8 },
  aiText: { fontSize: 8, color: T.ink, lineHeight: 1.35 },
  placeholder: { fontSize: 8, color: T.ink3, fontStyle: "italic" },
  empty: { fontSize: 11, color: T.ink2, textAlign: "center", marginTop: 60 },
  zebraRow: { backgroundColor: ZEBRA_FILL },
});

function Card({ label, card }: { label: string; card: StatCard }) {
  return (
    <View style={s.card}>
      <Text style={s.cardLbl}>{label}</Text>
      <View style={s.cardVals}>
        <Text style={s.cardBase}>{card.base}</Text>
        {card.scenario ? <Text style={s.cardArrow}>→</Text> : null}
        <Text style={s.cardScn}>{card.scenario}</Text>
      </View>
      {card.delta ? <Text style={s.cardDelta}>{card.delta}</Text> : null}
    </View>
  );
}

function MatrixSide({ title, cell }: { title: string; cell: PortfolioMatrixCell }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[s.mTh, { marginBottom: 2 }]}>{title}</Text>
      {([["Total", cell.total], ["Cash", cell.cash], ["Retirement", cell.retirement], ["Taxable", cell.taxable]] as const).map(
        ([lbl, v], i) => (
          <View key={lbl} style={i % 2 ? [s.mRow, s.zebraRow] : s.mRow}>
            <Text style={s.mCellLbl}>{lbl}</Text>
            <Text style={s.mCell}>{fmtUsd(v)}</Text>
          </View>
        ),
      )}
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

  const m = data.matrix!;
  const cards = [
    { label: "Legacy to heirs", card: data.legacy },
    { label: "Lifetime tax saved", card: data.taxSaved },
    { label: "Money lasts to", card: data.lastsToAge },
  ].filter((c) => c.card.show);

  return (
    <Fragment>
      {/* ── Page 1 · Where you'll stand ── */}
      <PageFrame firmName={firmName} clientName={clientName} reportDate={reportDate} pageIndex={pageIndex} totalPages={totalPages}>
        <SectionHead title={data.title} subtitle={data.subtitle} eyebrow="RETIREMENT COMPARISON" accent={accent} />
        <View style={s.verdict}>
          <Text style={s.verdictText}>{data.verdict.headline}</Text>
        </View>
        <View style={s.panel}>
          <Text style={s.h4}>Portfolio assets — proposed vs. current</Text>
          <OverlayBarsPdf bars={data.overlay} retirementYear={m.retirementYear} />
        </View>
        {cards.length > 0 ? (
          <View style={s.cards}>
            {cards.map((c) => <Card key={c.label} label={c.label} card={c.card} />)}
          </View>
        ) : null}
      </PageFrame>

      {/* ── Page 2 · The full picture ── */}
      <PageFrame firmName={firmName} clientName={clientName} reportDate={reportDate} pageIndex={pageIndex + 1} totalPages={totalPages}>
        <SectionHead title="Retirement Comparison — detail" eyebrow="RETIREMENT COMPARISON" accent={accent} />

        {data.maxSpend.show ? (
          <View style={s.panel}>
            <Text style={s.h4}>{`Maximum sustainable spending — ${fmtUsd(data.maxSpend.scenarioToday)}/yr proposed vs. ${fmtUsd(data.maxSpend.baseToday)}/yr current (today's dollars)`}</Text>
            <MaxSpendChartPdf series={data.maxSpend.series} />
          </View>
        ) : null}

        {data.confidence.show ? (
          <View style={s.panel}>
            <Text style={s.h4}>Range of outcomes — downside protection</Text>
            <ConfidenceRangeChartPdf points={data.confidence.points} />
          </View>
        ) : null}

        {data.showPortfolioMatrix ? (
          <View style={s.panel}>
            <Text style={s.h4}>{`Portfolio assets — retirement (${m.retirementYear}) & end of life (${m.endOfLifeYear})`}</Text>
            <View style={s.mHead}><Text style={[s.mCellLbl, s.mTh]}>At retirement</Text></View>
            <View style={s.twoCol}>
              <MatrixSide title="Base" cell={m.baseAtRetirement} />
              <MatrixSide title="Scenario" cell={m.scenarioAtRetirement} />
            </View>
            <View style={[s.mHead, { marginTop: 4 }]}><Text style={[s.mCellLbl, s.mTh]}>At end of life</Text></View>
            <View style={s.twoCol}>
              <MatrixSide title="Base" cell={m.baseAtEnd} />
              <MatrixSide title="Scenario" cell={m.scenarioAtEnd} />
            </View>
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
