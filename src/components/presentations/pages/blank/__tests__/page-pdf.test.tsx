import { describe, it, expect } from "vitest";
import { Document, renderToBuffer } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { BlankPagePdf } from "../page-pdf";
import { buildBlankPageData } from "@/lib/presentations/pages/blank/view-model";
import { DEFAULT_ACCENT } from "@/lib/presentations/theme";

describe("BlankPagePdf", () => {
  it("renders formatted markdown to a non-empty PDF buffer", async () => {
    ensureFontsRegistered();
    const data = buildBlankPageData({
      markdown: "# Heading\n\nSome **bold**, *italic*, and ***bold-italic*** text plus `code` and a list:\n\n- one\n- two\n\n> a quote",
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
          accent={DEFAULT_ACCENT}
        />
      </Document>,
    );
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("renders inline code combined with italics and inside a blockquote without throwing", async () => {
    // JetBrains Mono (used for code) has no italic face. A code run that is also
    // italic — directly via *`x`* or by inheriting the italic blockquote style —
    // must not ask @react-pdf for the missing variant, which would throw and
    // abort the whole deck.
    ensureFontsRegistered();
    const data = buildBlankPageData({
      markdown: "Try *`npm test`* and **`build`** now.\n\n> Run `deploy` first",
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
          accent={DEFAULT_ACCENT}
        />
      </Document>,
    );
    expect(buf.length).toBeGreaterThan(1000);
  });
});
