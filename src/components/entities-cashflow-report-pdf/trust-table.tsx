// src/components/entities-cashflow-report-pdf/trust-table.tsx
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { TrustCashFlowRow } from "@/engine/types";
import { TRUST_COLUMNS, formatCurrency, formatAges } from "../entities-cashflow-report/tokens";

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

export default function TrustTablePdf({ rows }: { rows: TrustCashFlowRow[] }) {
  return (
    <View>
      <View style={[s.row, s.header]}>
        {TRUST_COLUMNS.map((c, i) => (
          <Text key={c.key} style={i < 2 ? s.cellL : s.cell}>
            {c.label.join(" ")}
          </Text>
        ))}
      </View>
      {rows.map((r) => (
        <View key={r.year} style={s.row}>
          <Text style={s.cellL}>{r.year}</Text>
          <Text style={s.cellL}>{formatAges(r.ages)}</Text>
          <Text style={s.cell}>{formatCurrency(r.beginningBalance)}</Text>
          <Text style={s.cell}>{formatCurrency(r.transfersIn)}</Text>
          <Text style={s.cell}>{formatCurrency(r.growth)}</Text>
          <Text style={s.cell}>{formatCurrency(r.income)}</Text>
          <Text style={s.cell}>{formatCurrency(r.totalDistributions)}</Text>
          <Text style={s.cell}>{formatCurrency(r.expenses)}</Text>
          <Text style={s.cell}>{formatCurrency(r.taxes)}</Text>
          <Text style={s.cell}>{formatCurrency(r.endingBalance)}</Text>
        </View>
      ))}
    </View>
  );
}
