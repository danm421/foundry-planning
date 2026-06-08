import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { TocPdf } from "../page-pdf";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";

const BRANDING = {
  firmName: "Acme Wealth",
  clientName: "Jane & John Doe",
  reportDate: "June 8, 2026",
} as const;

describe("TocPdf", () => {
  it("renders a TOC with one section and the disclosures block", async () => {
    ensureFontsRegistered();
    const doc = (
      <Document>
        <TocPdf sections={[{ title: "Cash Flow", startPage: 3 }]} {...BRANDING} />
      </Document>
    );
    const buf = await renderToBuffer(doc);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("renders a TOC with multiple sections", async () => {
    ensureFontsRegistered();
    const doc = (
      <Document>
        <TocPdf
          sections={[
            { title: "Cash Flow", startPage: 3 },
            { title: "Balance Sheet", startPage: 4 },
            { title: "Income", startPage: 6 },
          ]}
          {...BRANDING}
        />
      </Document>
    );
    const buf = await renderToBuffer(doc);
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
