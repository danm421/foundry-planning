// The Solver's Cash Flow tab on paper: the income stack against Total Out, then
// one year's Inflows / Outflows breakdown and its bottom line — the year panel
// as it reads on screen.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { SectionHead } from "@/components/presentations/shared/section-head";
import { CashflowChartPdf } from "@/components/presentations/pages/cash-flow/chart-pdf";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { exactCurrency as fmt } from "@/lib/presentations/format";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type {
  BreakdownCategory,
  SolverCashFlowPageData,
} from "@/lib/presentations/pages/solver-cash-flow/view-model";

const MARKER_W = 14;

const S = StyleSheet.create({
  yearRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 6, marginBottom: 8 },
  year: { fontSize: 14, fontFamily: "JetBrains Mono", color: T.ink },
  age: { fontSize: 9, color: T.ink3 },
  cols: { flexDirection: "row", gap: 24 },
  col: { flex: 1 },
  colHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 3,
    borderBottomWidth: 0.75,
    borderBottomColor: T.hair2,
  },
  eyebrow: { fontSize: 7, color: T.ink3, textTransform: "uppercase", letterSpacing: 0.6 },
  category: { borderBottomWidth: 0.5, borderBottomColor: T.hair, paddingVertical: 3 },
  catRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  catLabel: { flexDirection: "row", alignItems: "center", flex: 1 },
  marker: { width: MARKER_W, flexDirection: "row", alignItems: "center" },
  swatch: { width: 6, height: 6, borderRadius: 1 },
  totalLine: { width: 8, height: 1.5, backgroundColor: T.chartLine },
  catName: { fontSize: 8.5, fontWeight: 600, color: T.ink },
  catVal: { fontSize: 8.5, fontFamily: "JetBrains Mono", color: T.ink },
  itemRow: { flexDirection: "row", justifyContent: "space-between", paddingLeft: MARKER_W, paddingTop: 1.5 },
  itemName: { fontSize: 7.5, color: T.ink3, flex: 1 },
  itemVal: { fontSize: 7.5, fontFamily: "JetBrains Mono", color: T.ink3 },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 4,
  },
  totalName: { fontSize: 9, fontWeight: 600, color: T.ink },
  totalVal: { fontSize: 9, fontFamily: "JetBrains Mono", fontWeight: 600, color: T.ink },
  withdrawals: { marginTop: 10 },
  kpis: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 36,
    marginTop: 12,
    paddingTop: 8,
    borderTopWidth: 0.75,
    borderTopColor: T.hair2,
  },
  kpi: { alignItems: "center" },
  kpiVal: { fontSize: 13, fontFamily: "JetBrains Mono", color: T.ink, marginTop: 3 },
  footnote: { marginTop: 10, fontSize: 7, color: T.ink3 },
  empty: { fontSize: 9, color: T.ink3, marginTop: 12 },
});

function Marker({ color }: { color: string | null }) {
  // An outflow has no bar to match, so it wears a neutral swatch.
  return (
    <View style={S.marker}>
      <View style={[S.swatch, { backgroundColor: color ?? T.ink3 }]} />
    </View>
  );
}

function Category({ c }: { c: BreakdownCategory }) {
  return (
    <View style={S.category} wrap={false}>
      <View style={S.catRow}>
        <View style={S.catLabel}>
          <Marker color={c.color} />
          <Text style={S.catName}>{c.label}</Text>
        </View>
        <Text style={S.catVal}>{fmt(c.total)}</Text>
      </View>
      {c.items.map((it) => (
        <View key={it.id} style={S.itemRow}>
          <Text style={S.itemName}>{it.label}</Text>
          <Text style={S.itemVal}>{fmt(it.amount)}</Text>
        </View>
      ))}
    </View>
  );
}

function Breakdown({
  heading,
  categories,
  totalLabel,
  total,
  totalMarker,
}: {
  heading: string;
  categories: BreakdownCategory[];
  totalLabel: string;
  total: number;
  totalMarker?: boolean;
}) {
  return (
    <View>
      <View style={S.colHead}>
        <Text style={S.eyebrow}>{heading}</Text>
        <Text style={S.eyebrow}>Amount</Text>
      </View>
      {categories.map((c) => (
        <Category key={c.key} c={c} />
      ))}
      <View style={S.totalRow}>
        <View style={S.catLabel}>
          {/* The chart draws Total Out as an ink line over the bars. */}
          <View style={S.marker}>{totalMarker ? <View style={S.totalLine} /> : null}</View>
          <Text style={S.totalName}>{totalLabel}</Text>
        </View>
        <Text style={S.totalVal}>{fmt(total)}</Text>
      </View>
    </View>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={S.kpi}>
      <Text style={S.eyebrow}>{label}</Text>
      <Text style={[S.kpiVal, color ? { color } : {}]}>{value}</Text>
    </View>
  );
}

export function SolverCashFlowPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  accent,
}: RenderPdfInput<SolverCashFlowPageData>) {
  return (
    <PageFrame
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
    >
      <SectionHead title={data.title} subtitle={data.subtitle} accent={accent} />
      {data.year == null ? (
        <Text style={S.empty}>No projection years to show.</Text>
      ) : (
        <>
          {data.chartSpec && <CashflowChartPdf spec={data.chartSpec} />}

          <View style={S.yearRow}>
            <Text style={S.year}>{String(data.year)}</Text>
            <Text style={S.age}>{data.ageLabel}</Text>
          </View>

          <View style={S.cols}>
            <View style={S.col}>
              <Breakdown
                heading="Inflows"
                categories={data.inflows}
                totalLabel="Total Inflows"
                total={data.totals.inflows}
              />
              {data.withdrawals && (
                <View style={S.withdrawals}>
                  <Category c={data.withdrawals} />
                </View>
              )}
            </View>
            <View style={S.col}>
              <Breakdown
                heading="Outflows"
                categories={data.outflows}
                totalLabel="Total Outflows"
                total={data.totals.outflows}
                totalMarker
              />
            </View>
          </View>

          <View style={S.kpis} wrap={false}>
            <Kpi
              label="Net Cash Flow"
              value={fmt(data.totals.net)}
              color={data.totals.net >= 0 ? T.good : T.crit}
            />
            {data.qcd > 0 && <Kpi label="QCDs" value={fmt(data.qcd)} />}
            {data.withdrawalRate > 0 && (
              <Kpi label="Withdrawal %" value={`${(data.withdrawalRate * 100).toFixed(2)}%`} />
            )}
            <Kpi label="Ending Portfolio" value={fmt(data.totals.endingPortfolio)} />
          </View>

          <Text style={S.footnote}>{data.footnote}</Text>
        </>
      )}
    </PageFrame>
  );
}
