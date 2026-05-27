import { Document } from "@react-pdf/renderer";
import { PRESENTATION_PAGES, type PresentationPageId } from "./registry";
import type { ProjectionYear, ClientData } from "@/engine/types";
import { ensureFontsRegistered } from "./shared/fonts";

interface PresentationDocumentProps {
  pages: Array<{
    pageId: PresentationPageId;
    options?: Record<string, unknown>;
  }>;
  firmName: string;
  clientName: string;
  reportDate: string;
  scenarioLabel: string;
  spouseName: string | null;
  years: ProjectionYear[];
  clientData: ClientData;
}

export function PresentationDocument(props: PresentationDocumentProps) {
  ensureFontsRegistered();
  const totalPages = props.pages.length;
  const ctx = {
    years: props.years,
    clientData: props.clientData,
    scenarioLabel: props.scenarioLabel,
    clientName: props.clientName,
    spouseName: props.spouseName,
  };

  return (
    <Document>
      {props.pages.map((p, idx) => {
        const page = PRESENTATION_PAGES[p.pageId];
        if (!page) return null;
        const options = { ...page.defaultOptions, ...(p.options ?? {}) };
        const data = page.buildData(ctx, options as never);
        return page.renderPdf({
          data,
          firmName: props.firmName,
          clientName: props.clientName,
          reportDate: props.reportDate,
          pageIndex: idx + 1,
          totalPages,
        });
      })}
    </Document>
  );
}
