import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { renderedPages } from "@/components/presentations/shared/test-utils/pdf-bbox";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import { buildMonthlyCashFlowPageData } from "@/lib/presentations/pages/cash-flow-monthly/view-model";
import { estimateMonthlyCashFlowPageCount, DISTRIBUTIONS_ROWS_PER_PAGE } from "@/lib/presentations/pages/cash-flow-monthly/options-schema";
import type { MonthlyCashFlowPageOptions } from "@/lib/presentations/pages/cash-flow-monthly/types";
import { makeRealDistributionsFixture } from "@/lib/presentations/pages/cash-flow-monthly/__tests__/real-fixture";
import { MonthlyCashFlowPagePdf } from "../page-pdf";

const { clientData, years } = makeRealDistributionsFixture();

async function render(range: MonthlyCashFlowPageOptions["range"], stretchTo?: number) {
  ensureFontsRegistered();
  const options: MonthlyCashFlowPageOptions = {
    view: "plan", basis: "today", range, year: null, mode: "distributions",
  };
  const built = buildMonthlyCashFlowPageData({
    years, clientData, options, scenarioLabel: "Base Case", clientName: "John", spouseName: "Jane",
  });
  // The fixture runs 30 years; a longer plan is the same rows over more years.
  const rows = stretchTo
    ? Array.from({ length: stretchTo }, (_, i) => ({ ...built.distribution!.rows[i % 30], year: 2000 + i }))
    : built.distribution!.rows;
  const data = { ...built, distribution: { ...built.distribution!, rows } };
  const buf = await renderToBuffer(
    <Document>
      <MonthlyCashFlowPagePdf
        data={data} firmName="Firm" clientName="John" reportDate="Oct 30, 2026"
        pageIndex={1} totalPages={2} accent={SECTION_ACCENTS["Cash Flow"]}
      />
    </Document>,
  );
  return { pages: renderedPages(buf), estimate: estimateMonthlyCashFlowPageCount(data, options), rows: data.distribution!.rows.length };
}

describe("Distributions page count", () => {
  it("is exactly 2 sheets for a one-year range, and the estimate agrees", async () => {
    const r = await render({ startYear: 2030, endYear: 2030 });
    expect(r.rows).toBe(1);
    expect(r.pages).toBe(2);
    expect(r.estimate).toBe(2);
  });

  it("is exactly 2 sheets for the full range, and the estimate agrees", async () => {
    const r = await render("full");
    expect(r.pages).toBe(2);
    expect(r.estimate).toBe(2);
  });

  it("a long plan wraps the table onto a third sheet, and the estimate says so", async () => {
    const atLimit = await render("full", DISTRIBUTIONS_ROWS_PER_PAGE);
    expect(atLimit.pages).toBe(2);
    expect(atLimit.estimate).toBe(2);
    const long = await render("full", 40);
    expect(long.pages).toBe(3);
    expect(long.estimate).toBe(3);
  });
}, 60_000);
