// src/components/reports-pdf/widgets/cashflow-table.tsx
//
// PDF render for the cashflowTable widget. Mirrors the screen render with
// a `<View>`-based grid (no HTML <table> available in @react-pdf/renderer).
// Year-range resolution runs server-side in the data-loader (Task 32) — the
// `years` array we receive here is already sliced to the resolved range.
//
// Visual treatment matches the Ethos comparison redesign branded table:
// dark header row (`inkDeep`/`inkOnDark`), zebra rows alternating
// `card2`/`zebra`, hairline separators, right-aligned numeric cells with
// year column left-aligned, and a 1.5px `accent` separator above the
// optional totals row.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import {
  totalIncome,
  type CashflowScopeData,
} from "@/lib/reports/scopes/cashflow";

const FMT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const s = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderColor: PDF_THEME.hair,
    backgroundColor: PDF_THEME.card2,
    borderRadius: PDF_THEME.radii.card,
    overflow: "hidden",
  },
  header: { paddingHorizontal: 10, paddingTop: 10, paddingBottom: 8 },
  title: {
    fontFamily: "Fraunces",
    fontSize: PDF_THEME.type.titleSubsection.pdfPx,
    color: PDF_THEME.ink,
  },
  subtitle: {
    fontSize: PDF_THEME.type.caption.pdfPx,
    color: PDF_THEME.ink3,
    marginTop: 2,
  },
  headRow: {
    flexDirection: "row",
    backgroundColor: PDF_THEME.inkDeep,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  headCell: {
    flex: 1,
    fontFamily: "JetBrains Mono",
    fontSize: 8,
    color: PDF_THEME.inkOnDark,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: PDF_THEME.hair,
  },
  rowCard: { backgroundColor: PDF_THEME.card2 },
  rowZebra: { backgroundColor: PDF_THEME.zebra },
  totalsRow: {
    flexDirection: "row",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderTopWidth: 1.5,
    borderTopColor: PDF_THEME.accent,
    backgroundColor: PDF_THEME.card2,
  },
  cell: {
    flex: 1,
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.ink,
  },
  cellNum: { textAlign: "right" },
  cellYear: { textAlign: "left" },
  cellBold: { fontWeight: 500 },
});

export function CashflowTablePdfRender({
  props,
  data,
}: WidgetRenderProps<"cashflowTable">) {
  const d = (data as { cashflow?: CashflowScopeData })?.cashflow;
  // The data-loader pre-filters `years` to the resolved range — render as-is.
  // Defensive `?? []` guards against a bypassed data-loader (e.g. fixtures).
  const rows = d?.years ?? [];
  const totals = rows.reduce(
    (a, r) => ({
      income: a.income + totalIncome(r),
      expenses: a.expenses + r.expenses,
      savings: a.savings + r.savings,
    }),
    { income: 0, expenses: 0, savings: 0 },
  );
  const headerAligns = [s.cellYear, s.cellNum, s.cellNum, s.cellNum, s.cellNum];

  return (
    <View style={s.wrap}>
      <View style={s.header}>
        <Text style={s.title}>{props.title}</Text>
        {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
      </View>
      <View style={s.headRow}>
        {["Year", "Income", "Expenses", "Savings", "Net"].map((h, i) => (
          <Text key={h} style={[s.headCell, headerAligns[i]]}>
            {h}
          </Text>
        ))}
      </View>
      {rows.map((r, i) => (
        <View
          key={r.year}
          style={[s.row, i % 2 === 0 ? s.rowCard : s.rowZebra]}
        >
          <Text style={[s.cell, s.cellYear]}>{r.year}</Text>
          <Text style={[s.cell, s.cellNum]}>{FMT.format(totalIncome(r))}</Text>
          <Text style={[s.cell, s.cellNum]}>{FMT.format(r.expenses)}</Text>
          <Text style={[s.cell, s.cellNum]}>{FMT.format(r.savings)}</Text>
          <Text
            style={[
              s.cell,
              s.cellNum,
              { color: r.net >= 0 ? PDF_THEME.good : PDF_THEME.crit },
            ]}
          >
            {FMT.format(r.net)}
          </Text>
        </View>
      ))}
      {props.showTotals && (
        <View style={s.totalsRow}>
          <Text style={[s.cell, s.cellYear, s.cellBold]}>Total</Text>
          <Text style={[s.cell, s.cellNum, s.cellBold]}>
            {FMT.format(totals.income)}
          </Text>
          <Text style={[s.cell, s.cellNum, s.cellBold]}>
            {FMT.format(totals.expenses)}
          </Text>
          <Text style={[s.cell, s.cellNum, s.cellBold]}>
            {FMT.format(totals.savings)}
          </Text>
          {/* Net total is "—": engine's per-year `net` doesn't sum cleanly across years. */}
          <Text style={[s.cell, s.cellNum, s.cellBold]}>—</Text>
        </View>
      )}
    </View>
  );
}
