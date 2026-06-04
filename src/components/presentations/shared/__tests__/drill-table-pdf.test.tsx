// src/components/presentations/shared/__tests__/drill-table-pdf.test.tsx
import { describe, it, expect } from "vitest";
import { Document, Page, renderToBuffer } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "../fonts";
import { DrillTablePdf } from "../drill-table-pdf";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import type { DrillPageData } from "@/lib/presentations/shared/drill-types";

ensureFontsRegistered();

const data: DrillPageData = {
  title: "Income",
  subtitle: "Base Case",
  table: {
    columns: [
      { key: "salary", header: "Salary", width: 40 },
      { key: "total", header: "TOTAL", width: 40, strong: true },
    ],
    rows: [
      { year: 2026, ageClient: 60, ageSpouse: 58, cells: { salary: 120000, total: 120000 } },
      { year: 2027, ageClient: 61, ageSpouse: 59, cells: { salary: 124000, total: 124000 } },
      { year: 2028, ageClient: 62, ageSpouse: 60, cells: { salary: 0, total: 0 } },
    ],
    markers: [{ year: 2027, kind: "retirement", who: "client", label: "Retire" }],
  },
  footnote: "Test",
};

describe("DrillTablePdf", () => {
  it("renders the drill table under a section accent", async () => {
    const buf = await renderToBuffer(
      <Document>
        <Page>
          <DrillTablePdf data={data} accent={SECTION_ACCENTS["Cash Flow"]} />
        </Page>
      </Document>,
    );
    expect(buf.length).toBeGreaterThan(0);
  });
});
