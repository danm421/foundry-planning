// src/components/reports-pdf/document.tsx
//
// Top-level @react-pdf/renderer Document. Walks the persisted page
// array, renders each page through ReportPage, and detects the cover
// page (single-slot, single-row, kind === "cover") so the wrapper can
// skip the running header/footer there.
//
// The widget side-effect import below registers all kinds with the
// widget registry; without it, RowRender will throw on first lookup.

import { Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "./fonts";
import "@/lib/reports/widgets/index.pdf";
import { ReportPage } from "./page-wrapper";
import { RowRender } from "./row-render";
import type { Page as ReportPageT } from "@/lib/reports/types";

ensureFontsRegistered();

export function ReportPdfDocument({
  pages,
  householdName,
  reportTitle,
  reportYear,
  firmName,
  widgetData,
  chartImages,
}: {
  pages: ReportPageT[];
  householdName: string;
  reportTitle: string;
  reportYear: number;
  firmName: string;
  widgetData: Record<string, unknown>;
  chartImages: Record<string, string>;
}) {
  const isCover = (p: ReportPageT) =>
    p.rows.length === 1 &&
    p.rows[0].slots.length === 1 &&
    p.rows[0].slots[0]?.kind === "cover";
  return (
    <Document>
      {pages.map((p, i) => (
        <ReportPage
          key={p.id}
          orientation={p.orientation}
          isCover={isCover(p)}
          householdName={householdName}
          reportTitle={reportTitle}
          reportYear={reportYear}
          firmName={firmName}
          pageIndex={i}
          totalPages={pages.length}
        >
          {p.rows.map((row) => (
            <RowRender
              key={row.id}
              row={row}
              widgetData={widgetData}
              chartImages={chartImages}
            />
          ))}
        </ReportPage>
      ))}
    </Document>
  );
}
