import { Document } from "@react-pdf/renderer";
import { PRESENTATION_PAGES, type PresentationPageId } from "./registry";
import type { ProjectionYear, ClientData } from "@/engine/types";
import { ensureFontsRegistered } from "./shared/fonts";
import { CoverPdf } from "./pages/cover/page-pdf";
import { TocPdf, type TocSection } from "./pages/toc/page-pdf";

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
  clientData: ClientData;
}

export function PresentationDocument(props: PresentationDocumentProps) {
  ensureFontsRegistered();

  // Resolve options + estimate page count per selected page.
  const resolved = props.pages.map((p) => {
    const page = PRESENTATION_PAGES[p.pageId];
    const options = { ...page.defaultOptions, ...(p.options ?? {}) };
    return { p, page, options };
  });

  const sections: TocSection[] = [];
  let cursor = 3; // page 1 = cover, page 2 = TOC, content starts at 3
  for (const { page, options } of resolved) {
    sections.push({ title: page.title, startPage: cursor });
    cursor += page.estimatePageCount(undefined as never, options as never);
  }

  const ctx = {
    years: props.years,
    clientData: props.clientData,
    scenarioLabel: props.scenarioLabel,
    clientName: props.clientName,
    spouseName: props.spouseName,
  };

  return (
    <Document>
      <CoverPdf
        firmName={props.firmName}
        firmTagline={props.firmTagline}
        clientName={props.clientName}
        spouseName={props.spouseName}
        scenarioLabel={props.scenarioLabel}
        reportDate={props.reportDate}
      />
      <TocPdf sections={sections} />
      {resolved.map(({ p, page, options }, idx) => {
        const pageScenarioLabel = p.scenarioOverrideLabel ?? props.scenarioLabel;
        const data = page.buildData(
          { ...ctx, scenarioLabel: pageScenarioLabel },
          options as never,
        );
        return page.renderPdf({
          data,
          firmName: props.firmName,
          clientName: props.clientName,
          reportDate: props.reportDate,
          pageIndex: sections[idx].startPage,
          totalPages: cursor - 1,
        });
      })}
    </Document>
  );
}
