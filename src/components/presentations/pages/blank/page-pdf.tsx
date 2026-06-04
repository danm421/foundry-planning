import { PageFrame } from "@/components/presentations/shared/page-frame";
import { MarkdownPdf } from "./markdown-pdf";
import type { BlankPageData } from "@/lib/presentations/pages/blank/view-model";
import type { RenderPdfInput } from "@/components/presentations/registry";

export function BlankPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
}: RenderPdfInput<BlankPageData>) {
  return (
    <PageFrame
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
    >
      <MarkdownPdf blocks={data.blocks} />
    </PageFrame>
  );
}
