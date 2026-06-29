// Generic drill-down table. Takes column defs + rows + markers; renders the
// year/age gutter and marker glyphs the same way the parent Cash Flow table
// does. Styling mirrors pages/cash-flow/table-pdf.tsx.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import type {
  DrillColumn,
  DrillPageData,
  DrillRow,
} from "@/lib/presentations/shared/drill-types";
import type { TableMarker } from "@/lib/presentations/types";
import { PRESENTATION_THEME, ZEBRA_FILL, type SectionAccent } from "@/lib/presentations/theme";
import { compactCurrency, jointAge } from "@/lib/presentations/format";

const styles = StyleSheet.create({
  table: { marginTop: 10 },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    borderTopWidth: 1,
    borderTopColor: PRESENTATION_THEME.hair2,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderLeftColor: PRESENTATION_THEME.hair2,
    borderRightColor: PRESENTATION_THEME.hair2,
    borderBottomWidth: 1, // bottom color set inline to the section accent
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  dataRow: {
    flexDirection: "row",
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderLeftColor: PRESENTATION_THEME.hair2,
    borderRightColor: PRESENTATION_THEME.hair2,
    borderBottomWidth: 0.5,
    borderBottomColor: PRESENTATION_THEME.hair2,
    paddingVertical: 3,
    paddingHorizontal: 2,
  },
  th: {
    fontFamily: "Inter",
    fontSize: 6.5,
    fontWeight: 600,
    lineHeight: 1.15,
    color: PRESENTATION_THEME.ink,
    paddingHorizontal: 1,
  },
  thStrong: {
    fontFamily: "Inter",
    fontSize: 6.5,
    fontWeight: 700,
    lineHeight: 1.15,
    color: PRESENTATION_THEME.ink,
    paddingHorizontal: 1,
  },
  td: {
    fontFamily: "Inter",
    fontSize: 6.5,
    color: PRESENTATION_THEME.ink2,
    paddingHorizontal: 1,
  },
  tdStrong: {
    fontFamily: "Inter",
    fontSize: 6.5,
    fontWeight: 600,
    color: PRESENTATION_THEME.ink,
    paddingHorizontal: 1,
  },
  tdRight: { textAlign: "right" },
  tdLeft: { textAlign: "left" },
  tdNeg: { color: PRESENTATION_THEME.crit, fontWeight: 600 },
  tdPos: { color: PRESENTATION_THEME.good, fontWeight: 600 },
  marker: {
    fontFamily: "Inter",
    fontSize: 7,
  },
});

const COL_MARKER_W = 10;
const COL_YEAR_W = 26;
const COL_AGE_W = 30;
const flexCell = { flex: 1 } as const;

export function DrillTablePdf({ data, accent }: { data: DrillPageData; accent: SectionAccent }) {
  const markerByYear = new Map(data.table.markers.map((m) => [m.year, m]));

  return (
    <View style={styles.table}>
      <View
        style={[styles.headerRow, { backgroundColor: accent.tint, borderBottomColor: accent.accent }]}
        fixed
      >
        <Text style={[styles.th, { width: COL_MARKER_W }, styles.tdLeft]}>
          {""}
        </Text>
        <Text style={[styles.th, { width: COL_YEAR_W }, styles.tdLeft]}>
          Year
        </Text>
        <Text style={[styles.th, { width: COL_AGE_W }, styles.tdLeft]}>
          Age(s)
        </Text>
        {data.table.columns.map((c, i) => {
          const isLast = i === data.table.columns.length - 1;
          return (
            <Text
              key={c.key}
              style={[
                c.strong ? styles.thStrong : styles.th,
                isLast ? { width: c.width } : flexCell,
                styles.tdRight,
              ]}
            >
              {c.header}
            </Text>
          );
        })}
      </View>
      {data.table.rows.map((row, i) => (
        <DrillDataRow
          key={row.year}
          row={row}
          columns={data.table.columns}
          marker={markerByYear.get(row.year) ?? null}
          zebra={i % 2 === 1}
          accent={accent.accent}
        />
      ))}
    </View>
  );
}

function DrillDataRow({
  row,
  columns,
  marker,
  zebra,
  accent,
}: {
  row: DrillRow;
  columns: DrillColumn[];
  marker: TableMarker | null;
  zebra: boolean;
  accent: string;
}) {
  return (
    <View style={[styles.dataRow, zebra ? { backgroundColor: ZEBRA_FILL } : {}]} wrap={false}>
      <Text style={[styles.marker, { color: accent, width: COL_MARKER_W }, styles.tdLeft]}>
        {marker ? (marker.kind === "retirement" ? "◇" : "△") : ""}
      </Text>
      <Text style={[styles.td, { width: COL_YEAR_W }, styles.tdLeft]}>
        {String(row.year)}
      </Text>
      <Text style={[styles.td, { width: COL_AGE_W }, styles.tdLeft]}>
        {jointAge(row.ageClient, row.ageSpouse)}
      </Text>
      {columns.map((c, i) => {
        const isLast = i === columns.length - 1;
        const v = row.cells[c.key] ?? 0;
        const baseStyle = c.strong ? styles.tdStrong : styles.td;
        const style: Style[] = [
          baseStyle,
          isLast ? { width: c.width } : flexCell,
          styles.tdRight,
        ];
        if (c.signColor) style.push(v < 0 ? styles.tdNeg : styles.tdPos);
        const text =
          c.format === "percent" ? `${(v * 100).toFixed(2)}%` : compactCurrency(v);
        return (
          <Text key={c.key} style={style}>
            {text}
          </Text>
        );
      })}
    </View>
  );
}
