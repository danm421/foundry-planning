import { describe, it, expect } from "vitest";
import { Document, renderToBuffer } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { BlankPagePdf } from "../page-pdf";
import { buildBlankPageData } from "@/lib/presentations/pages/blank/view-model";

describe("BlankPagePdf", () => {
  it("renders formatted markdown to a non-empty PDF buffer", async () => {
    ensureFontsRegistered();
    const data = buildBlankPageData({
      markdown: "# Heading\n\nSome **bold** and a list:\n\n- one\n- two\n\n> a quote",
    });
    const buf = await renderToBuffer(
      <Document>
        <BlankPagePdf
          data={data}
          firmName="Acme Advisors"
          clientName="Jane Cooper"
          reportDate="June 4, 2026"
          pageIndex={0}
          totalPages={1}
        />
      </Document>,
    );
    expect(buf.length).toBeGreaterThan(1000);
  });
});
