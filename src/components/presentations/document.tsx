import { Document } from "@react-pdf/renderer";
import { PRESENTATION_PAGES, type PresentationPageId } from "./registry";
import type { ProjectionYear, ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine";
import { ensureFontsRegistered } from "./shared/fonts";
import type { TocSection } from "./pages/toc/page-pdf";
import type { MonteCarloReportPayload } from "@/lib/presentations/pages/monte-carlo/view-model";

interface PresentationDocumentProps {
  pages: Array<{
    pageId: PresentationPageId;
    options?: Record<string, unknown> | undefined;
    scenarioOverrideLabel?: string | null; // V1: label-only override
  }>;
  firmName: string;
  firmTagline: string | null;
  clientName: string;
  reportDate: string;
  scenarioLabel: string;
  spouseName: string | null;
  years: ProjectionYear[];
  projection: ProjectionResult;
  clientData: ClientData;
  monteCarlo?: MonteCarloReportPayload | null;
}

export function PresentationDocument(props: PresentationDocumentProps) {
  ensureFontsRegistered();

  // Resolve per-page options + estimated page counts.
  const resolved = props.pages.map((p) => {
    const page = PRESENTATION_PAGES[p.pageId];
    const options = { ...page.defaultOptions, ...(p.options ?? {}) };
    const pageCount = page.estimatePageCount(undefined as never, options as never);
    return { p, page, options, pageCount };
  });

  // Compute each page's starting page number based on document order.
  const startPages = resolved.reduce<number[]>((acc, _entry, idx) => {
    const prevStart = idx === 0 ? 1 : acc[idx - 1];
    const prevCount = idx === 0 ? 0 : resolved[idx - 1].pageCount;
    acc.push(prevStart + prevCount);
    return acc;
  }, []);
  const totalPages = resolved.reduce((sum, { pageCount }) => sum + pageCount, 0);

  // TOC sections list every other selected page (excluding TOC entries
  // themselves), in document order, with their resolved page numbers.
  const documentSections: TocSection[] = resolved
    .map(({ page }, idx) => ({ title: page.title, startPage: startPages[idx], id: page.id }))
    .filter((s) => s.id !== "toc")
    .map(({ title, startPage }) => ({ title, startPage }));

  return (
    <Document>
      {resolved.map(({ p, page, options }, idx) => {
        const pageScenarioLabel = p.scenarioOverrideLabel ?? props.scenarioLabel;
        const data = page.buildData(
          {
            years: props.years,
            projection: props.projection,
            clientData: props.clientData,
            scenarioLabel: pageScenarioLabel,
            clientName: props.clientName,
            spouseName: props.spouseName,
            firmName: props.firmName,
            firmTagline: props.firmTagline,
            reportDate: props.reportDate,
            monteCarlo: props.monteCarlo ?? null,
          },
          options as never,
        );
        return page.renderPdf({
          data,
          firmName: props.firmName,
          clientName: props.clientName,
          reportDate: props.reportDate,
          pageIndex: startPages[idx],
          totalPages,
          documentSections,
        });
      })}
    </Document>
  );
}
