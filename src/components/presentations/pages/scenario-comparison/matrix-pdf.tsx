import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T, ZEBRA_FILL } from "@/lib/presentations/theme";
import { MONO } from "@/components/presentations/pages/retirement-comparison/chart-axis";
import type { ColumnHeader, MetricRow } from "@/lib/presentations/pages/scenario-comparison/types";
import { LABEL_COL_W, VALUE_COL_W } from "./geom";

const s = StyleSheet.create({
  table: { borderTopWidth: 0.75, borderTopColor: T.hair2, marginBottom: 8 },
  // 2, not 3: ten rows pay for this padding twice each, and sheet one has to
  // hold the cards, the matrix, the footnote AND the chart panel inside 652pt.
  row: { flexDirection: "row", alignItems: "center", borderBottomWidth: 0.5, borderBottomColor: T.hair, paddingVertical: 2 },
  label: { width: LABEL_COL_W, fontSize: 7.5, color: T.ink2 },
  labelIndent: { width: LABEL_COL_W, fontSize: 7, color: T.ink3, paddingLeft: 10 },
  cell: { width: VALUE_COL_W, paddingRight: 8 },
  // A pale wash only. A border here would turn the table into a grid of boxes.
  cellBest: { backgroundColor: ZEBRA_FILL, borderRadius: 2 },
  value: { fontSize: 8.5, color: T.ink, fontFamily: MONO },
  delta: { fontSize: 6.5, fontFamily: MONO, marginTop: 1 },
});

function deltaColor(direction: 1 | -1 | 0): string {
  return direction === 1 ? T.good : direction === -1 ? T.crit : T.ink3;
}

export function MatrixPdf({ columns, rows }: { columns: ColumnHeader[]; rows: MetricRow[] }) {
  return (
    <View style={s.table}>
      {rows.map((r) => (
        <View key={r.label} style={s.row}>
          <Text style={r.indent ? s.labelIndent : s.label}>{r.label}</Text>
          {r.cells.slice(0, columns.length).map((c, i) => (
            <View key={columns[i].refKey} style={[s.cell, c.isBest ? s.cellBest : {}]}>
              <Text style={s.value}>{c.value}</Text>
              {c.delta ? (
                <Text style={[s.delta, { color: deltaColor(c.direction) }]}>{c.delta}</Text>
              ) : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
