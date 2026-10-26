import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { renderedPages, wordBoxes, type Word } from "@/components/presentations/shared/test-utils/pdf-bbox";
import { solverCashFlowPage } from "@/components/presentations/registry";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import type { SolverCashFlowPageData } from "@/lib/presentations/pages/solver-cash-flow/view-model";
import { build, withLiabilities } from "@/lib/presentations/pages/solver-cash-flow/__tests__/fixtures";

async function render(data: SolverCashFlowPageData): Promise<Buffer> {
  ensureFontsRegistered();
  return renderToBuffer(
    <Document>
      {solverCashFlowPage.renderPdf({
        data,
        firmName: "Ethos Financial Group",
        clientName: "Jennifer & David",
        reportDate: "October 23, 2026",
        pageIndex: 3,
        totalPages: 9,
        documentSections: [],
        accent: SECTION_ACCENTS["Cash Flow"],
      })}
    </Document>,
  );
}

const text = (words: Word[]) => words.map((w) => w.text).join(" ");

/** The top of the footer's disclaimer — the line the body must stay above. */
const footerTop = (words: Word[]) => words.find((w) => w.text === "illustrative")!.yMin;

describe("SolverCashFlowPagePdf", () => {
  it("prints the chart above a breakdown that fits, on the one sheet it counted", async () => {
    const data = build(2026);
    const pdf = await render(data);
    const pages = renderedPages(pdf);
    expect(pages).toBe(solverCashFlowPage.estimatePageCount(data, { year: 2026 }));
    expect(pages).toBe(1);
    const words = wordBoxes(pdf, 1);
    const legend = words.find((w) => w.text === "Out")!;
    const inflowsHead = words.find((w) => w.text === "INFLOWS")!;
    expect(legend.yMax).toBeLessThan(inflowsHead.yMin);
    expect(text(words)).toContain("NET CASH FLOW");
  });

  for (const count of [25, 80]) {
    it(`carries ${count} line items over the sheets it counted, none squeezed`, async () => {
      const data = withLiabilities(count);
      const pdf = await render(data);
      const pages = renderedPages(pdf);
      expect(pages).toBe(solverCashFlowPage.estimatePageCount(data, { year: 2026 }));
      expect(pages).toBeGreaterThan(1);

      let printed = 0;
      for (let page = 1; page <= pages; page++) {
        const words = wordBoxes(pdf, page);
        // Only the first sheet carries the chart; the rest say they continue it.
        expect(words.some((w) => w.text === "Out")).toBe(page === 1);
        if (page > 1) expect(text(words)).toContain("continued");
        // Squeezed rows print over each other: every line item keeps its own
        // line, and the lowest one stays above the footer.
        const rows = words.filter((w) => w.text === "Mortgage").map((w) => w.yMin).sort((a, b) => a - b);
        rows.slice(1).forEach((y, i) => expect(y - rows[i]).toBeGreaterThan(10));
        const body = words.filter((w) => w.yMin < footerTop(words));
        expect(Math.max(...body.map((w) => w.yMax))).toBeLessThan(footerTop(words));
        printed += rows.length;
        expect(text(words).includes("NET CASH FLOW")).toBe(page === pages);
      }
      expect(printed).toBe(count);
    });
  }
});
