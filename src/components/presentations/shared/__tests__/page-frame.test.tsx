import { describe, it, expect } from "vitest";
import { renderToBuffer, Document, Text } from "@react-pdf/renderer";
import { PageFrame } from "../page-frame";
import { ensureFontsRegistered } from "../fonts";

describe("PageFrame", () => {
  it("renders a content page (with footer disclaimer) without throwing", async () => {
    ensureFontsRegistered();
    const doc = (
      <Document>
        <PageFrame
          firmName="Acme Wealth"
          clientName="Jane Doe"
          reportDate="June 8, 2026"
          pageIndex={2}
          totalPages={5}
        >
          <Text>Body content</Text>
        </PageFrame>
      </Document>
    );
    const buf = await renderToBuffer(doc);
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
