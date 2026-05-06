// src/components/reports-pdf/widgets/expense-detail-table.tsx
//
// PDF render for the expenseDetailTable widget. Mirrors the screen
// render: branded table with dark header row, zebra rows, hairline
// separators, and an accent-ruled totals row at the bottom.
//
// V1 scope: flat year/expense rows (per the Phase-5d plan; engine
// category-attribution work is needed before grouping is possible).
//
// The data-loader pre-filters `years` to the resolved range — no
// re-resolution here.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { CashflowScopeData } from "@/lib/reports/scopes/cashflow";

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
  header: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
  title: {
    fontFamily: "Fraunces",
    fontSize: PDF_THEME.type.titleSubsection.pdfPx,
    color: PDF_THEME.ink,
  },
  headRow: {
    flexDirection: "row",
    backgroundColor: PDF_THEME.inkDeep,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  headCell: {
    flex: 1,
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.inkOnDark,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderTopWidth: 1,
    borderTopColor: PDF_THEME.hair,
  },
  rowCard: { backgroundColor: PDF_THEME.card2 },
  rowZebra: { backgroundColor: PDF_THEME.zebra },
  totalsRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 6,
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
  cellLeft: { textAlign: "left" },
  cellBold: { fontWeight: 500 },
  empty: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: PDF_THEME.hair,
    fontFamily: "Inter",
    fontSize: PDF_THEME.type.caption.pdfPx,
    color: PDF_THEME.ink3,
    textAlign: "center",
  },
});

export function ExpenseDetailTablePdfRender({
  props,
  data,
}: WidgetRenderProps<"expenseDetailTable">) {
  const d = (data as { cashflow?: CashflowScopeData })?.cashflow;
  const rows = d?.years ?? [];
  const total = rows.reduce((sum, r) => sum + r.expenses, 0);

  return (
    <View style={s.wrap}>
      <View style={s.header}>
        <Text style={s.title}>{props.title}</Text>
      </View>
      <View style={s.headRow}>
        <Text style={[s.headCell, s.cellLeft]}>Year</Text>
        <Text style={[s.headCell, s.cellNum]}>Annual Expense</Text>
      </View>
      {rows.length === 0 ? (
        <Text style={s.empty}>No expense data available.</Text>
      ) : (
        <>
          {rows.map((r, i) => (
            <View
              key={r.year}
              style={[s.row, i % 2 === 0 ? s.rowCard : s.rowZebra]}
            >
              <Text style={[s.cell, s.cellLeft]}>{r.year}</Text>
              <Text style={[s.cell, s.cellNum]}>{FMT.format(r.expenses)}</Text>
            </View>
          ))}
          <View style={s.totalsRow}>
            <Text style={[s.cell, s.cellLeft, s.cellBold]}>Total</Text>
            <Text style={[s.cell, s.cellNum, s.cellBold]}>
              {FMT.format(total)}
            </Text>
          </View>
        </>
      )}
    </View>
  );
}
