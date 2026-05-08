// src/components/entities-cashflow-report-pdf/document.tsx
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { SelectedRows } from "../entities-cashflow-report/view-model";
import TrustTable from "./trust-table";
import BusinessTable from "./business-table";

/**
 * Light, print-friendly palette mirroring balance-sheet-report-pdf's PDF_THEME so
 * the two reports look like siblings when sent to a client.
 */
const THEME = {
  page: "#ffffff",
  divider: "#e2e8f0", // slate-200
  textPrimary: "#0f172a", // slate-900
  textMuted: "#64748b", // slate-500
} as const;

const styles = StyleSheet.create({
  page: {
    backgroundColor: THEME.page,
    padding: 32,
    color: THEME.textPrimary,
    fontFamily: "Helvetica",
    fontSize: 9,
  },
  header: {
    borderBottomWidth: 1,
    borderBottomColor: THEME.divider,
    paddingBottom: 10,
    marginBottom: 16,
  },
  title: { fontSize: 18, fontWeight: "bold" },
  subtitle: { color: THEME.textMuted, fontSize: 10, marginTop: 2 },
  empty: { color: THEME.textMuted, fontSize: 10 },
  footer: {
    position: "absolute",
    bottom: 16,
    left: 32,
    right: 32,
    fontSize: 9,
    color: THEME.textMuted,
    textAlign: "center",
  },
});

interface Props {
  selected: SelectedRows;
  entityName: string;
}

export default function CashFlowDocument({ selected, entityName }: Props) {
  const generatedAt = new Date().toLocaleDateString();
  return (
    <Document>
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Entities Cash Flow — {entityName}</Text>
          <Text style={styles.subtitle}>Generated {generatedAt}</Text>
        </View>

        {selected.kind === "trust" && <TrustTable rows={selected.rows} />}
        {selected.kind === "business" && <BusinessTable rows={selected.rows} />}
        {selected.kind === "empty" && (
          <Text style={styles.empty}>No activity for this entity in the selected year range.</Text>
        )}

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          fixed
        />
      </Page>
    </Document>
  );
}
