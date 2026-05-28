import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { CoverPdf } from "../page-pdf";

describe("CoverPdf", () => {
  it("renders without throwing", async () => {
    ensureFontsRegistered();
    const doc = (
      <Document>
        <CoverPdf
          firmName="Foundry Planning"
          firmTagline="Cash-flow-based planning"
          clientName="Cooper Sample"
          spouseName="Susan Sample"
          scenarioLabel="Base Case"
          reportDate="May 28, 2026"
        />
      </Document>
    );
    const buf = await renderToBuffer(doc);
    expect(buf.byteLength).toBeGreaterThan(0);
  });

  it("renders without tagline and spouseName", async () => {
    ensureFontsRegistered();
    const doc = (
      <Document>
        <CoverPdf
          firmName="Foundry"
          firmTagline={null}
          clientName="Single Client"
          spouseName={null}
          scenarioLabel="Base Case"
          reportDate="May 28, 2026"
        />
      </Document>
    );
    const buf = await renderToBuffer(doc);
    expect(buf.byteLength).toBeGreaterThan(0);
  });
});
