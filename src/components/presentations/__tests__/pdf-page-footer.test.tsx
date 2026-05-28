import { describe, it, expect } from "vitest";
import { renderToBuffer, Document, Page } from "@react-pdf/renderer";
import { PdfPageFooter } from "../pdf-page-footer";

describe("PdfPageFooter", () => {
  it("renders inside a Document without throwing (single-page snapshot)", async () => {
    const doc = (
      <Document>
        <Page size="LETTER">
          <PdfPageFooter />
        </Page>
      </Document>
    );
    const buf = await renderToBuffer(doc);
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
