import { PageFrame } from "@/components/presentations/shared/page-frame";
import { MarkdownPdf } from "./markdown-pdf";
import type { BlankPageData } from "@/lib/presentations/pages/blank/view-model";

// Local prop type to stay free of a circular import with registry.tsx
// (registry will import this file in a later task). Shape matches
// RenderPdfInput<BlankPageData> from registry — kept local to avoid the cycle.
interface BlankPagePdfProps {
  data: BlankPageData;
  firmName: string;
  clientName: string;
  reportDate: string;
  pageIndex: number;
  totalPages: number;
}

export function BlankPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
}: BlankPagePdfProps) {
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
