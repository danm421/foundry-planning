import { Text, StyleSheet } from "@react-pdf/renderer";
import type { EntityCashFlowPageData } from "./types";
import { PRESENTATION_THEME, type SectionAccent } from "@/lib/presentations/theme";
import { PageFrame } from "../../shared/page-frame";
import { SectionHead } from "../../shared/section-head";
import TrustTablePdf from "@/components/entities-cashflow-report-pdf/trust-table";
import BusinessTablePdf from "@/components/entities-cashflow-report-pdf/business-table";

const styles = StyleSheet.create({
  empty: {
    marginTop: 12,
    fontFamily: "Inter",
    fontSize: 9,
    color: PRESENTATION_THEME.ink3,
  },
});

export function EntityCashFlowPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  accent,
}: {
  data: EntityCashFlowPageData;
  firmName: string;
  clientName: string;
  reportDate: string;
  pageIndex: number;
  totalPages: number;
  accent: SectionAccent;
}) {
  return (
    <PageFrame
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
    >
      <SectionHead title={data.title} subtitle={data.subtitle} accent={accent} />
      {data.selected.kind === "trust" && <TrustTablePdf rows={data.selected.rows} />}
      {data.selected.kind === "business" && <BusinessTablePdf rows={data.selected.rows} />}
      {data.selected.kind === "empty" && (
        <Text style={styles.empty}>
          No activity for this entity in the selected year range — pick a trust or business in the page options.
        </Text>
      )}
    </PageFrame>
  );
}
