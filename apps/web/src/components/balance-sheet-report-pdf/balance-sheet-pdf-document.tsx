// src/components/balance-sheet-report-pdf/balance-sheet-pdf-document.tsx
import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { BalanceSheetViewModel } from "../balance-sheet-report/view-model";
import { PDF_THEME, CATEGORY_HEX } from "../balance-sheet-report/tokens";
import type { YoyResult } from "../balance-sheet-report/yoy";

interface PdfProps {
  clientName: string;
  asOfLabel: string;
  viewLabel: string;
  generatedAt: string;
  viewModel: BalanceSheetViewModel;
  donutPng: string | null;
  barPng: string | null;
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: PDF_THEME.surface.page,
    padding: 32,
    color: PDF_THEME.text.primary,
    fontFamily: "Helvetica",
    fontSize: 10,
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: PDF_THEME.surface.divider,
    paddingBottom: 10,
    marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: "bold" },
  subtitle: { color: PDF_THEME.text.muted, fontSize: 10, marginTop: 2 },
  row: { flexDirection: "row", gap: 16 },
  column: { flex: 1, flexDirection: "column", gap: 10 },
  panel: {
    borderWidth: 1,
    borderColor: PDF_THEME.surface.panelBorder,
    backgroundColor: PDF_THEME.surface.panel,
    borderRadius: 4,
    padding: 10,
  },
  panelTitle: {
    fontSize: 9,
    textTransform: "uppercase",
    color: PDF_THEME.text.muted,
    marginBottom: 4,
  },
  bigValue: { fontSize: 16, fontWeight: "bold" },
  catHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: PDF_THEME.surface.divider,
  },
  netWorthCard: {
    borderWidth: 1,
    borderColor: PDF_THEME.surface.netWorthBorder,
    backgroundColor: PDF_THEME.surface.netWorthAccent,
    borderRadius: 4,
    padding: 12,
  },
  chartImage: { width: "100%", marginTop: 6 },
  footer: {
    position: "absolute",
    bottom: 16,
    left: 32,
    right: 32,
    fontSize: 9,
    color: PDF_THEME.text.muted,
    textAlign: "center",
  },
  badge: {
    fontSize: 8,
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderRadius: 2,
    borderWidth: 0.5,
  },
  dot: { width: 6, height: 6, borderRadius: 3, marginRight: 4 },
});

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

function Badge({ yoy }: { yoy: YoyResult | null }) {
  if (yoy == null) return null;
  const palette =
    yoy.badge === "up" ? PDF_THEME.status.up
    : yoy.badge === "down" ? PDF_THEME.status.down
    : PDF_THEME.status.flat;
  const arrow = yoy.badge === "up" ? "▲" : yoy.badge === "down" ? "▼" : "·";
  const sign = yoy.value > 0 ? "+" : "";
  return (
    <Text style={[styles.badge, { color: palette.fg, backgroundColor: palette.bg, borderColor: palette.border }]}>
      {arrow} {sign}{yoy.value.toFixed(1)}%
    </Text>
  );
}

export function BalanceSheetPdfDocument({
  clientName,
  asOfLabel,
  viewLabel,
  generatedAt,
  viewModel,
  donutPng,
  barPng,
}: PdfProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Balance Sheet — {clientName}</Text>
          <Text style={styles.subtitle}>
            As of {asOfLabel} · {viewLabel} · Generated {generatedAt}
          </Text>
        </View>

        <View style={styles.row}>
          {/* Left: Assets */}
          <View style={styles.column}>
            <Text style={styles.panelTitle}>Assets</Text>
            {viewModel.assetCategories.map((cat) => (
              <View key={cat.key} style={styles.panel}>
                <View style={styles.catHeader}>
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <View style={[styles.dot, { backgroundColor: CATEGORY_HEX[cat.key] }]} />
                    <Text>{cat.label}</Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                    <Text>{formatCurrency(cat.total)}</Text>
                    <Badge yoy={cat.yoy} />
                  </View>
                </View>
                {cat.rows.map((r) => (
                  <View key={r.accountId} style={styles.itemRow}>
                    <Text>{r.accountName}{r.hasLinkedMortgage ? " (M)" : ""}</Text>
                    <Text>{formatCurrency(r.value)}</Text>
                  </View>
                ))}
              </View>
            ))}
            {viewModel.outOfEstateRows.length > 0 && (
              <View style={styles.panel}>
                <Text style={{ marginBottom: 4 }}>Out of Estate (Entity-owned)</Text>
                {viewModel.outOfEstateRows.map((r) => (
                  <View key={r.accountId} style={styles.itemRow}>
                    <Text>{r.accountName}</Text>
                    <Text>{formatCurrency(r.value)}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          {/* Center: totals + charts */}
          <View style={styles.column}>
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Total Assets</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={styles.bigValue}>{formatCurrency(viewModel.totalAssets)}</Text>
                <Badge yoy={viewModel.yoy.totalAssets} />
              </View>
              {donutPng && <Image src={donutPng} style={styles.chartImage} />}
            </View>
            <View style={styles.panel}>
              <Text style={styles.panelTitle}>Assets vs Liabilities</Text>
              {barPng && <Image src={barPng} style={styles.chartImage} />}
            </View>
            {viewModel.realEstateEquity > 0 && (
              <View style={styles.panel}>
                <Text style={styles.panelTitle}>Real Estate Equity</Text>
                <Text>{formatCurrency(viewModel.realEstateEquity)}</Text>
              </View>
            )}
            <View style={styles.netWorthCard}>
              <Text style={styles.panelTitle}>Net Worth</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Text style={styles.bigValue}>{formatCurrency(viewModel.netWorth)}</Text>
                <Badge yoy={viewModel.yoy.netWorth} />
              </View>
            </View>
          </View>

          {/* Right: Liabilities */}
          <View style={styles.column}>
            <Text style={styles.panelTitle}>Liabilities &amp; Net Worth</Text>
            <View style={styles.panel}>
              <View style={styles.catHeader}>
                <Text>Total Liabilities</Text>
                <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                  <Text>{formatCurrency(viewModel.totalLiabilities)}</Text>
                  <Badge yoy={viewModel.yoy.totalLiabilities} />
                </View>
              </View>
              {viewModel.liabilityRows.length === 0 ? (
                <Text style={{ color: PDF_THEME.text.muted }}>No liabilities.</Text>
              ) : (
                viewModel.liabilityRows.map((r) => (
                  <View key={r.liabilityId} style={styles.itemRow}>
                    <Text>{r.liabilityName}</Text>
                    <Text>{formatCurrency(r.balance)}</Text>
                  </View>
                ))
              )}
            </View>
          </View>
        </View>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}
