// src/components/entities-cashflow-report-pdf/business-table.tsx
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { BusinessCashFlowRow } from "@/engine/types";
import { BUSINESS_COLUMNS, formatCurrency, formatAges } from "../entities-cashflow-report/tokens";

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderColor: "#e2e8f0", // slate-200
    paddingVertical: 3,
  },
  cell: { flex: 1, textAlign: "right", paddingHorizontal: 4 },
  cellL: { flex: 1, textAlign: "left", paddingHorizontal: 4 },
  header: {
    fontFamily: "Helvetica-Bold",
    backgroundColor: "#f1f5f9", // slate-100
    color: "#334155", // slate-700
  },
});

export default function BusinessTablePdf({ rows }: { rows: BusinessCashFlowRow[] }) {
  return (
    <View>
      <View style={[s.row, s.header]}>
        {BUSINESS_COLUMNS.map((c, i) => (
          <Text key={c.key} style={i < 2 ? s.cellL : s.cell}>
            {c.label}
          </Text>
        ))}
      </View>
      {rows.map((r) => (
        <View key={r.year} style={s.row}>
          <Text style={s.cellL}>{r.year}</Text>
          <Text style={s.cellL}>{formatAges(r.ages)}</Text>
          <Text style={s.cell}>{formatCurrency(r.beginningTotalValue)}</Text>
          <Text style={s.cell}>{formatCurrency(r.beginningBasis)}</Text>
          <Text style={s.cell}>{formatCurrency(r.growth)}</Text>
          <Text style={s.cell}>{formatCurrency(r.income)}</Text>
          <Text style={s.cell}>{formatCurrency(r.expenses)}</Text>
          <Text style={s.cell}>{formatCurrency(r.annualDistribution)}</Text>
          <Text style={s.cell}>{formatCurrency(r.retainedEarnings)}</Text>
          <Text style={s.cell}>{formatCurrency(r.endingTotalValue)}</Text>
          <Text style={s.cell}>{formatCurrency(r.endingBasis)}</Text>
        </View>
      ))}
    </View>
  );
}
