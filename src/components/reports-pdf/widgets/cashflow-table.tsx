// src/components/reports-pdf/widgets/cashflow-table.tsx
//
// PDF render for the cashflowTable widget. Mirrors the screen render with
// a `<View>`-based grid (no HTML <table> available in @react-pdf/renderer).
// Year-range resolution is server-side (Task 32); for now the PDF renders
// the absolute `years` from the cashflow scope.

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
    padding: 8,
    borderWidth: 1,
    borderColor: PDF_THEME.hair,
    backgroundColor: PDF_THEME.card2,
    borderRadius: 3,
  },
  title: { fontSize: 12, color: PDF_THEME.ink, marginBottom: 4 },
  subtitle: { fontSize: 9, color: PDF_THEME.ink3, marginBottom: 6 },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderColor: PDF_THEME.hair,
    paddingVertical: 4,
  },
  cell: {
    flex: 1,
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.ink,
  },
  cellNum: { textAlign: "right" },
  cellYear: { textAlign: "left" },
  head: {
    fontFamily: "JetBrains Mono",
    fontSize: 8,
    color: PDF_THEME.ink3,
    textTransform: "uppercase",
  },
  totalRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderColor: PDF_THEME.ink,
    paddingVertical: 4,
  },
});

export function CashflowTablePdfRender({
  props,
  data,
}: WidgetRenderProps<"cashflowTable">) {
  const d = (data as { cashflow?: CashflowScopeData })?.cashflow;
  // Use absolute years from scope; year-range resolution runs server-side
  // (Task 32). Until then, rendering the full scope is the safest default.
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
      <Text style={s.title}>{props.title}</Text>
      {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
      <View
        style={[s.row, { borderBottomWidth: 1, borderColor: PDF_THEME.ink }]}
      >
        {["Year", "Income", "Expenses", "Savings", "Net"].map((h, i) => (
          <Text key={h} style={[s.cell, s.head, headerAligns[i]]}>
            {h}
          </Text>
        ))}
      </View>
      {rows.map((r) => (
        <View key={r.year} style={s.row}>
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
        <View style={s.totalRow}>
          <Text style={[s.cell, s.cellYear]}>Total</Text>
          <Text style={[s.cell, s.cellNum]}>{FMT.format(totals.income)}</Text>
          <Text style={[s.cell, s.cellNum]}>{FMT.format(totals.expenses)}</Text>
          <Text style={[s.cell, s.cellNum]}>{FMT.format(totals.savings)}</Text>
          {/* Net total is "—": engine's per-year `net` doesn't sum cleanly across years. */}
          <Text style={[s.cell, s.cellNum]}>—</Text>
        </View>
      )}
    </View>
  );
}
