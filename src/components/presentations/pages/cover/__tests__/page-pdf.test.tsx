import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { CoverPdf } from "../page-pdf";

// A 1x1 transparent PNG — stands in for a firm logo data URL.
const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

describe("CoverPdf", () => {
  it("renders the split cover with a firm logo + accent", async () => {
    ensureFontsRegistered();
    const doc = (
      <Document>
        <CoverPdf
          title="Financial Plan Comparison"
          firmName="Ethos Financial Group"
          firmTagline="Current vs. Proposed"
          clientName="Cooper Sample"
          spouseName="Susan Sample"
          scenarioLabel="Base Case"
          reportDate="May 28, 2026"
          logoDataUrl={PNG_1PX}
          accentColor="#2f6b4a"
        />
      </Document>
    );
    const buf = await renderToBuffer(doc);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("falls back to the firm-name wordmark with no logo, tagline, or spouse", async () => {
    ensureFontsRegistered();
    const doc = (
      <Document>
        <CoverPdf
          firmName="Foundry Planning"
          firmTagline={null}
          clientName="Single Client"
          spouseName={null}
          scenarioLabel="Base Case"
          reportDate="May 28, 2026"
          logoDataUrl={null}
          accentColor="#b87f1f"
        />
      </Document>
    );
    const buf = await renderToBuffer(doc);
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
