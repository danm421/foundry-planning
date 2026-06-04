import { Text, StyleSheet } from "@react-pdf/renderer";
import type { CashFlowPageData } from "@/lib/presentations/types";
import { PRESENTATION_THEME, type SectionAccent } from "@/lib/presentations/theme";
import { PageFrame } from "../../shared/page-frame";
import { SectionHead } from "../../shared/section-head";
import { Callout } from "../../shared/callout";
import { CashflowChartPdf } from "./chart-pdf";
import { CashflowTablePdf } from "./table-pdf";

const styles = StyleSheet.create({
  footnote: {
    marginTop: 12,
    fontFamily: "Inter",
    fontSize: 7,
    color: PRESENTATION_THEME.ink3,
  },
});

export function CashflowPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  accent,
}: {
  data: CashFlowPageData;
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
      {data.callout && <Callout accent={accent}>{data.callout}</Callout>}
      <CashflowChartPdf spec={data.chartSpec} />
      <CashflowTablePdf data={data} accent={accent} />
      <Text style={styles.footnote}>{data.footnote}</Text>
    </PageFrame>
  );
}
