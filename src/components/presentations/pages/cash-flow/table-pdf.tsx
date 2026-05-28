import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import type { CashFlowPageData, CashFlowTableRow, TableMarker } from "@/lib/presentations/types";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";
import { compactCurrency, jointAge } from "@/lib/presentations/format";

const styles = StyleSheet.create({
  table: { marginTop: 10 },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-end",                 // align single-line headers to the bottom of 2-line ones
    backgroundColor: PRESENTATION_THEME.card,
    borderBottomWidth: 1,
    borderBottomColor: PRESENTATION_THEME.accent,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  dataRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: PRESENTATION_THEME.hair,
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
  marker: { fontFamily: "Inter", fontSize: 7, color: PRESENTATION_THEME.accent },
});

interface ColDef {
  key: string;
  header: string;
  width: number;
  strong?: boolean;        // bold totals (TOTAL INCOME / TOTAL EXPENSES / Portfolio Assets)
  signColor?: boolean;     // Net Cash Flow gets green/red
  value: (row: CashFlowTableRow) => number;
}

// Portrait LETTER usable width ≈ 526pt. Sum below (with marker+year+age
// gutter) = ~478pt — leaves comfortable margin. Each header is pre-split into
// two lines so react-pdf never breaks a word mid-syllable at the column edge.
const COLUMNS: ColDef[] = [
  { key: "income",    header: "Income",                width: 36, value: (r) => r.cells.salary + r.cells.socialSecurity },
  { key: "rmds",      header: "RMDs",                  width: 28, value: (r) => r.cells.rmds },
  { key: "other",     header: "Other\nInflows",        width: 32, value: (r) => r.cells.otherInflows },
  { key: "totIncome", header: "TOTAL\nINCOME",         width: 38, strong: true, value: (r) => r.cells.totalIncome },
  { key: "expenses",  header: "Expenses",              width: 36, value: (r) => r.cells.expenses },
  { key: "savings",   header: "Savings",               width: 28, value: (r) => r.cells.savings },
  { key: "totExp",    header: "TOTAL\nEXPENSES",       width: 40, strong: true, value: (r) => r.cells.totalExpenses },
  { key: "netCf",     header: "Net Cash\nFlow",        width: 42, signColor: true, value: (r) => r.cells.netCashFlow },
  { key: "pGrowth",   header: "Portfolio\nGrowth",     width: 42, value: (r) => r.cells.portfolioGrowth },
  { key: "pActivity", header: "Portfolio\nActivity",   width: 44, value: (r) => r.cells.portfolioActivity },
  { key: "pAssets",   header: "Portfolio\nAssets",     width: 40, strong: true, value: (r) => r.cells.portfolioAssets },
];

const COL_MARKER_W = 10;
const COL_YEAR_W = 26;
const COL_AGE_W = 30;

export function CashflowTablePdf({ data }: { data: CashFlowPageData }) {
  const markerByYear = new Map(data.table.markers.map((m) => [m.year, m]));

  return (
    <View style={styles.table}>
      <View style={styles.headerRow} fixed>
        <Text style={[styles.th, { width: COL_MARKER_W }, styles.tdLeft]}>{""}</Text>
        <Text style={[styles.th, { width: COL_YEAR_W }, styles.tdLeft]}>Year</Text>
        <Text style={[styles.th, { width: COL_AGE_W }, styles.tdLeft]}>Age(s)</Text>
        {COLUMNS.map((c) => (
          <Text
            key={c.key}
            style={[c.strong ? styles.thStrong : styles.th, { width: c.width }, styles.tdRight]}
          >
            {c.header}
          </Text>
        ))}
      </View>
      {data.table.rows.map((row) => (
        <CashflowDataRow key={row.year} row={row} marker={markerByYear.get(row.year) ?? null} />
      ))}
    </View>
  );
}

function CashflowDataRow({
  row,
  marker,
}: {
  row: CashFlowTableRow;
  marker: TableMarker | null;
}) {
  return (
    <View style={styles.dataRow} wrap={false}>
      <Text style={[styles.marker, { width: COL_MARKER_W }, styles.tdLeft]}>
        {marker ? (marker.kind === "retirement" ? "◇" : "△") : ""}
      </Text>
      <Text style={[styles.td, { width: COL_YEAR_W }, styles.tdLeft]}>{String(row.year)}</Text>
      <Text style={[styles.td, { width: COL_AGE_W }, styles.tdLeft]}>
        {jointAge(row.ageClient, row.ageSpouse)}
      </Text>
      {COLUMNS.map((c) => {
        const v = c.value(row);
        const baseStyle = c.strong ? styles.tdStrong : styles.td;
        const style: Style[] = [baseStyle, { width: c.width }, styles.tdRight];
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
