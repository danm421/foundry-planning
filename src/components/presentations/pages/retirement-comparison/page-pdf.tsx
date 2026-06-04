import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { SectionHead } from "@/components/presentations/shared/section-head";
import { PRESENTATION_THEME as T, ZEBRA_FILL } from "@/lib/presentations/theme";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type {
  RetirementComparisonPageData,
  ComparisonKpi,
  PortfolioMatrixCell,
} from "@/lib/presentations/pages/retirement-comparison/types";
import type { ChangeRow, DisplayUnit } from "@/lib/presentations/pages/scenario-changes/types";
import { fmtUsdCompact as fmtUsd } from "@/lib/presentations/pages/retirement-comparison/format";
import { OverlayBarsPdf } from "./chart-pdf";

const s = StyleSheet.create({
  subtitle: { fontSize: 8, color: T.ink2, marginBottom: 8 },
  kpis: { flexDirection: "row", gap: 6, marginBottom: 10 },
  kpi: { flex: 1, backgroundColor: T.card, borderWidth: 1, borderColor: T.hair, borderRadius: 3, padding: 6 },
  kpiLbl: { fontSize: 6.5, color: T.ink2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 },
  kpiVals: { flexDirection: "row", alignItems: "baseline", gap: 4, marginTop: 3 },
  kpiBase: { fontSize: 8, color: T.ink3 },
  kpiArrow: { fontSize: 8, color: T.ink3 },
  kpiScn: { fontSize: 13, fontWeight: 700, color: T.ink },
  kpiDelta: { fontSize: 7.5, fontWeight: 700, marginTop: 2 },
  panel: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair, borderRadius: 3, padding: 10, marginBottom: 8 },
  h4: { fontSize: 8, color: T.ink2, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 4 },
  twoCol: { flexDirection: "row", gap: 8 },
  mRow: { flexDirection: "row", paddingVertical: 2.5, paddingHorizontal: 3 },
  mHead: { flexDirection: "row", paddingVertical: 3, paddingHorizontal: 3, borderBottomWidth: 1, borderBottomColor: T.hair },
  mCellLbl: { flex: 1.2, fontSize: 7, color: T.ink },
  mCell: { flex: 1, fontSize: 7.5, color: T.ink, textAlign: "right" },
  mTh: { fontSize: 6, color: T.ink3, fontWeight: 700, textTransform: "uppercase" },
  cRow: { flexDirection: "row", paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: T.hair },
  cWhat: { fontSize: 7.5, color: T.ink },
  cDetail: { fontSize: 6.5, color: T.ink3, lineHeight: 1.3, marginTop: 1 },
  cVals: { flexDirection: "row", alignItems: "baseline", gap: 3 },
  cBefore: { fontSize: 7.5, color: T.ink3, textAlign: "right" },
  cArrow: { fontSize: 7, color: T.ink3 },
  cAfter: { fontSize: 7.5, fontWeight: 700, color: T.good, textAlign: "right" },
  cAfterRemove: { color: T.crit },
  pill: { fontSize: 5.5, fontWeight: 700, color: T.card, backgroundColor: T.steel, paddingVertical: 1, paddingHorizontal: 3, borderRadius: 2, marginBottom: 2, alignSelf: "flex-start" },
  ai: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair, borderLeftWidth: 3, borderLeftColor: T.accent, borderRadius: 3, padding: 8 },
  aiText: { fontSize: 8, color: T.ink, lineHeight: 1.35 },
  placeholder: { fontSize: 8, color: T.ink3, fontStyle: "italic" },
  empty: { fontSize: 11, color: T.ink2, textAlign: "center", marginTop: 60 },
  zebraRow: { backgroundColor: ZEBRA_FILL },
});

function Kpi({ k }: { k: ComparisonKpi }) {
  const deltaColor = k.direction === 1 ? T.good : k.direction === -1 ? T.crit : T.ink3;
  return (
    <View style={s.kpi}>
      <Text style={s.kpiLbl}>{k.label}</Text>
      <View style={s.kpiVals}>
        <Text style={s.kpiBase}>{k.base}</Text>
        <Text style={s.kpiArrow}>→</Text>
        <Text style={s.kpiScn}>{k.scenario}</Text>
      </View>
      <Text style={[s.kpiDelta, { color: deltaColor }]}>{k.deltaLabel}</Text>
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

function ChangeRowView({ row }: { row: ChangeRow }) {
  const afterStyle = row.op === "remove" ? [s.cAfter, s.cAfterRemove] : s.cAfter;
  // Show before → after only when a meaningful prior value applies (edits).
  // Adds/removes have no real "before", so they keep the single Added/Removed label.
  const showBefore = row.op === "edit" && row.before !== "—";
  return (
    <View style={s.cRow} wrap={false}>
      <View style={{ flex: 1 }}>
        <Text style={s.cWhat}>{row.what}</Text>
        {row.detail.length > 0 ? <Text style={s.cDetail}>{row.detail.join(" · ")}</Text> : null}
      </View>
      {showBefore ? (
        <View style={s.cVals}>
          <Text style={s.cBefore}>{row.before}</Text>
          <Text style={s.cArrow}>→</Text>
          <Text style={afterStyle}>{row.after}</Text>
        </View>
      ) : (
        <Text style={afterStyle}>{row.after}</Text>
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
  return (
    <PageFrame firmName={firmName} clientName={clientName} reportDate={reportDate} pageIndex={pageIndex} totalPages={totalPages}>
      <SectionHead title={data.title} subtitle={data.subtitle} eyebrow="RETIREMENT COMPARISON" accent={accent} />

      <View style={s.kpis}>
        {data.kpis.map((k) => <Kpi key={k.label} k={k} />)}
      </View>

      <View style={s.panel}>
        <Text style={s.h4}>Portfolio assets — scenario vs. base case</Text>
        <OverlayBarsPdf bars={data.overlay} retirementYear={m.retirementYear} />
      </View>

      <View style={s.twoCol}>
        {data.showChanges ? (
          <View style={[s.panel, { flex: 1 }]}>
            <Text style={s.h4}>Changes made</Text>
            {data.changeUnits.length === 0 ? (
              <Text style={s.placeholder}>No changes vs. the base plan.</Text>
            ) : (
              data.changeUnits.map((unit: DisplayUnit, i) =>
                unit.kind === "row" ? (
                  <ChangeRowView key={`r${i}`} row={unit.row} />
                ) : (
                  <View key={`g${i}`}>
                    <Text style={s.pill}>{unit.label}</Text>
                    {unit.rows.map((r, j) => <ChangeRowView key={`g${i}-${j}`} row={r} />)}
                  </View>
                ),
              )
            )}
          </View>
        ) : null}

        {data.showPortfolioMatrix ? (
          <View style={[s.panel, { flex: 1 }]}>
            <Text style={s.h4}>{`Portfolio assets — retirement (${m.retirementYear}) & end of life (${m.endOfLifeYear})`}</Text>
            <View style={s.mHead}>
              <Text style={[s.mCellLbl, s.mTh]}>At retirement</Text>
            </View>
            <View style={s.twoCol}>
              <MatrixSide title="Base" cell={m.baseAtRetirement} />
              <MatrixSide title="Scenario" cell={m.scenarioAtRetirement} />
            </View>
            <View style={[s.mHead, { marginTop: 4 }]}>
              <Text style={[s.mCellLbl, s.mTh]}>At end of life</Text>
            </View>
            <View style={s.twoCol}>
              <MatrixSide title="Base" cell={m.baseAtEnd} />
              <MatrixSide title="Scenario" cell={m.scenarioAtEnd} />
            </View>
          </View>
        ) : null}
      </View>

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
  );
}
