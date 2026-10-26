// The Assets tab's Balance Sheet report, printed inside the deck's frame. The
// body is the report PDF's own, so the two cannot drift; a long household runs
// on over as many sheets as it needs.
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { SectionHead } from "@/components/presentations/shared/section-head";
import { BalanceSheetPdfBody } from "@/components/balance-sheet-report-pdf/balance-sheet-pdf-document";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { BalanceSheetReportPageData } from "@/lib/presentations/pages/balance-sheet-report/view-model";

export function BalanceSheetReportPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  accent,
}: RenderPdfInput<BalanceSheetReportPageData>) {
  return (
    <PageFrame
      flow
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
    >
      <SectionHead title="Balance Sheet" subtitle={data.subtitle} accent={accent} />
      <BalanceSheetPdfBody view={data.view} accentColor={accent.accent} />
    </PageFrame>
  );
}
