import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { YearlyLiquidityReport } from "@/lib/estate/yearly-liquidity-report";
import { YearlyLiquidityPdfTable } from "./table";

interface Props {
  clientName: string;
  generatedAt: string;
  report: YearlyLiquidityReport;
  chartPng: string | null;
}

const styles = StyleSheet.create({
  page: {
    backgroundColor: "#0b1020",
    padding: 32,
    color: "#e5e7eb",
    fontFamily: "Helvetica",
    fontSize: 10,
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: "#374151",
    paddingBottom: 10,
    marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: "bold" },
  subtitle: { color: "#9ca3af", fontSize: 10, marginTop: 2 },
  chartImage: { width: "100%", marginTop: 8, marginBottom: 8 },
  footer: {
    position: "absolute",
    bottom: 16,
    left: 32,
    right: 32,
    fontSize: 9,
    color: "#9ca3af",
    textAlign: "center",
  },
});

export function YearlyLiquidityPdfDocument({
  clientName,
  generatedAt,
  report,
  chartPng,
}: Props) {
  return (
    <Document>
      <Page size="LETTER" orientation="landscape" style={styles.page} wrap>
        <View style={styles.header}>
          <Text style={styles.title}>Estate Liquidity</Text>
          <Text style={styles.subtitle}>
            {clientName} · Hypothetical: both die in year · Generated {generatedAt}
          </Text>
        </View>
        {chartPng && (
          // jsx-a11y/alt-text targets HTML <img>; @react-pdf/renderer's <Image>
          // is a PDF primitive with no alt prop. Suppress the false positive.
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image src={chartPng} style={styles.chartImage} />
        )}
        <YearlyLiquidityPdfTable report={report} />
        <Text style={styles.footer} fixed>
          Foundry Planning · For advisory use
        </Text>
      </Page>
    </Document>
  );
}
