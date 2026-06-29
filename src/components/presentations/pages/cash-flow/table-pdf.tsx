import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import type { CashFlowPageData, CashFlowTableRow, TableMarker } from "@/lib/presentations/types";
import { PRESENTATION_THEME, ZEBRA_FILL, type SectionAccent } from "@/lib/presentations/theme";
import { compactCurrency, jointAge } from "@/lib/presentations/format";

const styles = StyleSheet.create({
  table: { marginTop: 10 },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-end",                 // align single-line headers to the bottom of 2-line ones
    borderTopWidth: 1,
    borderTopColor: PRESENTATION_THEME.hair2,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderLeftColor: PRESENTATION_THEME.hair2,
    borderRightColor: PRESENTATION_THEME.hair2,
    borderBottomWidth: 1,                    // bottom color set inline to the section accent
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
  marker: { fontFamily: "Inter", fontSize: 7 },
});

interface ColDef {
  key: string;
  header: string;
  strong?: boolean;        // bold totals (TOTAL INCOME / TOTAL EXPENSES / Portfolio Assets)
  signColor?: boolean;     // Net Cash Flow gets green/red
  value: (row: CashFlowTableRow) => number;
}

// Year/age gutter is pinned left at fixed widths; the last data column is pinned
// right at a fixed width; middle columns share remaining space equally via flex.
// Each header is pre-split into two lines so react-pdf never breaks a word
// mid-syllable at the column edge.
const COLUMNS: ColDef[] = [
  { key: "income",    header: "Income",                value: (r) => r.cells.salary + r.cells.socialSecurity },
  { key: "rmds",      header: "RMDs",                  value: (r) => r.cells.rmds },
  { key: "other",     header: "Other\nInflows",        value: (r) => r.cells.otherInflows },
  { key: "totIncome", header: "TOTAL\nINCOME",         strong: true, value: (r) => r.cells.totalIncome },
  { key: "expenses",  header: "Expenses",              value: (r) => r.cells.expenses },
  { key: "savings",   header: "Savings",               value: (r) => r.cells.savings },
  { key: "totExp",    header: "TOTAL\nEXPENSES",       strong: true, value: (r) => r.cells.totalExpenses },
  { key: "netCf",     header: "Net Cash\nFlow",        signColor: true, value: (r) => r.cells.netCashFlow },
  { key: "pGrowth",   header: "Portfolio\nGrowth",     value: (r) => r.cells.portfolioGrowth },
  { key: "pActivity", header: "Portfolio\nActivity",   value: (r) => r.cells.portfolioActivity },
  { key: "pAssets",   header: "Portfolio\nAssets",     strong: true, value: (r) => r.cells.portfolioAssets },
];

const COL_MARKER_W = 10;
const COL_YEAR_W = 26;
const COL_AGE_W = 30;
const COL_LAST_W = 40;
const flexCell = { flex: 1 } as const;

export function CashflowTablePdf({ data, accent }: { data: CashFlowPageData; accent: SectionAccent }) {
  const markerByYear = new Map(data.table.markers.map((m) => [m.year, m]));

  return (
    <View style={styles.table}>
      <View style={[styles.headerRow, { backgroundColor: accent.tint, borderBottomColor: accent.accent }]} fixed>
        <Text style={[styles.th, { width: COL_MARKER_W }, styles.tdLeft]}>{""}</Text>
        <Text style={[styles.th, { width: COL_YEAR_W }, styles.tdLeft]}>Year</Text>
        <Text style={[styles.th, { width: COL_AGE_W }, styles.tdLeft]}>Age(s)</Text>
        {COLUMNS.map((c, i) => {
          const isLast = i === COLUMNS.length - 1;
          return (
            <Text
              key={c.key}
              style={[
                c.strong ? styles.thStrong : styles.th,
                isLast ? { width: COL_LAST_W } : flexCell,
                styles.tdRight,
              ]}
            >
              {c.header}
            </Text>
          );
        })}
      </View>
      {data.table.rows.map((row, i) => (
        <CashflowDataRow key={row.year} row={row} marker={markerByYear.get(row.year) ?? null} zebra={i % 2 === 1} accent={accent.accent} />
      ))}
    </View>
  );
}

function CashflowDataRow({
  row,
  marker,
  zebra,
  accent,
}: {
  row: CashFlowTableRow;
  marker: TableMarker | null;
  zebra: boolean;
  accent: string;
}) {
  return (
    <View style={[styles.dataRow, zebra ? { backgroundColor: ZEBRA_FILL } : {}]} wrap={false}>
      <Text style={[styles.marker, { color: accent, width: COL_MARKER_W }, styles.tdLeft]}>
        {marker ? (marker.kind === "retirement" ? "◇" : "△") : ""}
      </Text>
      <Text style={[styles.td, { width: COL_YEAR_W }, styles.tdLeft]}>{String(row.year)}</Text>
      <Text style={[styles.td, { width: COL_AGE_W }, styles.tdLeft]}>
        {jointAge(row.ageClient, row.ageSpouse)}
      </Text>
      {COLUMNS.map((c, i) => {
        const isLast = i === COLUMNS.length - 1;
        const v = c.value(row);
        const baseStyle = c.strong ? styles.tdStrong : styles.td;
        const style: Style[] = [
          baseStyle,
          isLast ? { width: COL_LAST_W } : flexCell,
          styles.tdRight,
        ];
        if (c.signColor) style.push(v < 0 ? styles.tdNeg : styles.tdPos);
        return (
          <Text key={c.key} style={style}>
            {compactCurrency(v)}
          </Text>
        );
      })}
    </View>
  );
}
