// Generic drill-down page. Same composition as pages/cash-flow/page-pdf.tsx;
// renders SectionHead → Callout → Chart → Table → footnote inside the
// PageFrame chrome.

import { Text, StyleSheet } from "@react-pdf/renderer";
import type { DrillPageData } from "@/lib/presentations/shared/drill-types";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";
import { PageFrame } from "./page-frame";
import { SectionHead } from "./section-head";
import { Callout } from "./callout";
import { CashflowChartPdf } from "../pages/cash-flow/chart-pdf";
import { DrillTablePdf } from "./drill-table-pdf";

const styles = StyleSheet.create({
  footnote: {
    marginTop: 12,
    fontFamily: "Inter",
    fontSize: 7,
    color: PRESENTATION_THEME.ink3,
  },
});

export function DrillPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
}: {
  data: DrillPageData;
  firmName: string;
  clientName: string;
  reportDate: string;
  pageIndex: number;
  totalPages: number;
}) {
  return (
    <PageFrame
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
    >
      <SectionHead title={data.title} subtitle={data.subtitle} />
      {data.callout && <Callout>{data.callout}</Callout>}
      {data.chartSpec && <CashflowChartPdf spec={data.chartSpec} />}
      <DrillTablePdf data={data} />
      <Text style={styles.footnote}>{data.footnote}</Text>
    </PageFrame>
  );
}
