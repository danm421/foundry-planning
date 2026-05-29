import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { EstateFlowChartPagePdf } from "../estate-flow-chart/page-pdf";
import { EstateFlowReportPagePdf } from "../estate-flow/page-pdf";
import type { EstateFlowChartData } from "@/lib/presentations/pages/estate-flow-chart/view-model";
import type { EstateFlowReportData } from "@/lib/presentations/pages/estate-flow/view-model";

ensureFontsRegistered();

const framing = {
  firmName: "Foundry",
  clientName: "Cooper Sample",
  reportDate: "May 28, 2026",
  pageIndex: 1,
  totalPages: 1,
};

const emptyChart: EstateFlowChartData = {
  title: "Estate Flow",
  subtitle: "Base Case",
  summary: null,
  showHeirDetail: true,
};

const emptyReport: EstateFlowReportData = {
  title: "Estate Flow",
  subtitle: "Base Case",
  ownership: { groups: [], grandTotal: 0 },
  asOfYear: 2026,
  firstColumn: null,
  secondColumn: null,
  showHeirDetail: true,
};

describe("estate page PDFs render", () => {
  it("chart renders with a null summary", async () => {
    const buf = await renderToBuffer(
      <Document>{EstateFlowChartPagePdf({ data: emptyChart, ...framing })}</Document>,
    );
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("report renders with empty columns", async () => {
    const buf = await renderToBuffer(
      <Document>{EstateFlowReportPagePdf({ data: emptyReport, ...framing })}</Document>,
    );
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
