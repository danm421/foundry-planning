import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { YearlyLiquidityReport } from "@/lib/estate/yearly-liquidity-report";

const styles = StyleSheet.create({
  table: { width: "100%", marginTop: 8, fontSize: 8 },
  headerRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#374151",
    paddingBottom: 4,
    marginBottom: 4,
  },
  row: {
    flexDirection: "row",
    paddingVertical: 2,
    borderBottomWidth: 0.25,
    borderBottomColor: "#1f2937",
  },
  footerRow: {
    flexDirection: "row",
    paddingTop: 6,
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: "#374151",
    fontWeight: "bold",
  },
  cellLeft: { flex: 1, textAlign: "left" },
  cellNum: { flex: 1.4, textAlign: "right" },
  surplus: { color: "#10b981" },
  deficit: { color: "#ef4444" },
});

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function moneyText(value: number): { text: string; isDeficit: boolean } {
  if (value < 0) return { text: `(${fmt.format(-value)})`, isDeficit: true };
  return { text: fmt.format(value), isDeficit: false };
}

export function YearlyLiquidityPdfTable({ report }: { report: YearlyLiquidityReport }) {
  return (
    <View style={styles.table}>
      <View style={styles.headerRow}>
        <Text style={styles.cellLeft}>Year</Text>
        <Text style={styles.cellLeft}>Age</Text>
        <Text style={styles.cellNum}>Ins. In Estate</Text>
        <Text style={styles.cellNum}>Ins. Out Of Estate</Text>
        <Text style={styles.cellNum}>Total Insurance</Text>
        <Text style={styles.cellNum}>Portfolio Assets</Text>
        <Text style={styles.cellNum}>Transfer Cost</Text>
        <Text style={styles.cellNum}>Surplus / Deficit</Text>
      </View>
      {report.rows.map((r) => {
        const surplus = moneyText(r.surplusDeficitWithPortfolio);
        const ageLabel =
          r.ageClient != null && r.ageSpouse != null
            ? `${r.ageClient}/${r.ageSpouse}`
            : (r.ageClient ?? r.ageSpouse ?? "—").toString();
        return (
          <View key={r.year} style={styles.row}>
            <Text style={styles.cellLeft}>{r.year}</Text>
            <Text style={styles.cellLeft}>{ageLabel}</Text>
            <Text style={styles.cellNum}>{fmt.format(r.insuranceInEstate)}</Text>
            <Text style={styles.cellNum}>{fmt.format(r.insuranceOutOfEstate)}</Text>
            <Text style={styles.cellNum}>{fmt.format(r.totalInsuranceBenefit)}</Text>
            <Text style={styles.cellNum}>{fmt.format(r.totalPortfolioAssets)}</Text>
            <Text style={styles.cellNum}>{fmt.format(r.totalTransferCost)}</Text>
            <Text style={[styles.cellNum, surplus.isDeficit ? styles.deficit : styles.surplus]}>
              {surplus.text}
            </Text>
          </View>
        );
      })}
      <FooterRow report={report} />
    </View>
  );
}

function FooterRow({ report }: { report: YearlyLiquidityReport }) {
  const t = report.totals;
  const surplus = moneyText(t.surplusDeficitWithPortfolio);
  return (
    <View style={styles.footerRow}>
      <Text style={styles.cellLeft}>Lifetime</Text>
      <Text style={styles.cellLeft}>—</Text>
      <Text style={styles.cellNum}>{fmt.format(t.insuranceInEstate)}</Text>
      <Text style={styles.cellNum}>{fmt.format(t.insuranceOutOfEstate)}</Text>
      <Text style={styles.cellNum}>{fmt.format(t.totalInsuranceBenefit)}</Text>
      <Text style={styles.cellNum}>{fmt.format(t.totalPortfolioAssets)}</Text>
      <Text style={styles.cellNum}>{fmt.format(t.totalTransferCost)}</Text>
      <Text style={[styles.cellNum, surplus.isDeficit ? styles.deficit : styles.surplus]}>
        {surplus.text}
      </Text>
    </View>
  );
}
