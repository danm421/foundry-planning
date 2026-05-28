import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { TocPdf } from "../page-pdf";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";

describe("TocPdf", () => {
  it("renders a TOC with one section without throwing", async () => {
    ensureFontsRegistered();
    const doc = (
      <Document>
        <TocPdf sections={[{ title: "Cash Flow", startPage: 3 }]} />
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
        />
      </Document>
    );
    const buf = await renderToBuffer(doc);
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
