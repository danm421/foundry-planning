import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { CashFlowPageData, CashFlowTableRow, TableMarker } from "@/lib/presentations/types";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";
import { compactCurrency, jointAge } from "@/lib/presentations/format";

const styles = StyleSheet.create({
  table: { marginTop: 10 },
  headerRow: {
    flexDirection: "row",
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
    fontSize: 7,
    fontWeight: 600,
    color: PRESENTATION_THEME.ink,
    paddingHorizontal: 2,
  },
  td: {
    fontFamily: "Inter",
    fontSize: 7,
    color: PRESENTATION_THEME.ink2,
    paddingHorizontal: 2,
  },
  tdRight: { textAlign: "right" },
  tdLeft: { textAlign: "left" },
  marker: { fontFamily: "Inter", fontSize: 7, color: PRESENTATION_THEME.accent },
});

const COL_WIDTHS = [
  16,  // marker gutter
  32,  // year
  36,  // age
  50,  // expenses
  44,  // salary
  50,  // ss
  50,  // other income
  60,  // rmd
  50,  // withdrawals
  60,  // total withdrawals
  46,  // net savings
  60,  // total portfolio
];

const HEADERS = [
  "", "Year", "Age", "Expenses", "Salary", "SS",
  "Other", "RMD", "Withdrawals", "Total W/D", "Savings", "Portfolio",
];

export function CashflowTablePdf({ data }: { data: CashFlowPageData }) {
  const markerByYear = new Map(data.table.markers.map((m) => [m.year, m]));

  return (
    <View style={styles.table}>
      <View style={styles.headerRow} fixed>
        {HEADERS.map((h, i) => (
          <Text
            key={h || `gutter-${i}`}
            style={[
              styles.th,
              { width: COL_WIDTHS[i] },
              i <= 2 ? styles.tdLeft : styles.tdRight,
            ]}
          >
            {h}
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
  const cells = [
    marker ? (marker.kind === "retirement" ? "◇" : "△") : "",
    String(row.year),
    jointAge(row.ageClient, row.ageSpouse),
    compactCurrency(row.cells.totalExpenses),
    compactCurrency(row.cells.salary),
    compactCurrency(row.cells.socialSecurity),
    compactCurrency(row.cells.otherIncome),
    compactCurrency(row.cells.rmds),
    compactCurrency(row.cells.withdrawals),
    compactCurrency(row.cells.totalWithdrawalsSpent),
    compactCurrency(row.cells.netSavings),
    compactCurrency(row.cells.totalPortfolioAssets),
  ];

  return (
    <View style={styles.dataRow} wrap={false}>
      {cells.map((c, i) => (
        <Text
          key={i}
          style={[
            i === 0 ? styles.marker : styles.td,
            { width: COL_WIDTHS[i] },
            i <= 2 ? styles.tdLeft : styles.tdRight,
          ]}
        >
          {c}
        </Text>
      ))}
    </View>
  );
}
