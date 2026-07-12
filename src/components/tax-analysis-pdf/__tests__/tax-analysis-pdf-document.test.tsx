import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { TaxAnalysisPdfDocument } from "../tax-analysis-pdf-document";
import { buildTaxAnalysis } from "@/lib/tax-analysis/analysis";
import { createTaxResolver } from "@/lib/tax/resolver";
import { params2025, retireeMfj, highEarnerMfj } from "@/lib/tax-analysis/__tests__/fixtures";

const resolver = createTaxResolver([params2025], { taxInflationRate: 0.025, ssWageGrowthRate: 0.03 });

describe("TaxAnalysisPdfDocument", () => {
  it("renders a non-trivial PDF for each persona", async () => {
    for (const facts of [retireeMfj(), highEarnerMfj()]) {
      const analysis = buildTaxAnalysis({ facts, prior: null, resolver, primaryAge: 72, spouseAge: 70 });
      const buffer = await renderToBuffer(
        <TaxAnalysisPdfDocument
          clientName="Sam & Casey Cooper"
          taxYear={facts.taxYear}
          generatedAt="July 10, 2026"
          analysis={analysis}
        />,
      );
      expect(buffer.length).toBeGreaterThan(2000);
    }
  }, 30000);

  it("renders a non-trivial PDF when ordinary taxBase is 0 (preferential income consumes all taxable income)", async () => {
    // Same fixture recipe as bracket-map-bars.test.tsx's NaN-regression case:
    // deductions eat the ordinary portion entirely, so
    // ordinary.taxBase clamps to 0 (Math.max(0, ti - preferentialBase)) and
    // exercises the PDF's `Math.max(taxBase * 1.25, visible[last].from)` bar
    // scaleTop / per-segment width math at taxBase=0.
    const facts = retireeMfj();
    facts.deductions.taxableIncome = 30000;
    facts.income.netLongTermGain = 50000;
    facts.income.netShortTermGain = 0;
    facts.income.qualifiedDividends = 0;
    const analysis = buildTaxAnalysis({ facts, prior: null, resolver, primaryAge: 72, spouseAge: 70 });
    expect(analysis.bracketMap?.ordinary.taxBase).toBe(0);

    const buffer = await renderToBuffer(
      <TaxAnalysisPdfDocument
        clientName="Sam & Casey Cooper"
        taxYear={facts.taxYear}
        generatedAt="July 10, 2026"
        analysis={analysis}
      />,
    );
    expect(buffer.length).toBeGreaterThan(2000);
  }, 30000);

  it("includes composition + deduction blocks and still renders a non-trivial PDF", async () => {
    const facts = highEarnerMfj();
    const analysis = buildTaxAnalysis({ facts, prior: null, resolver, primaryAge: 45, spouseAge: 45 });
    // Guard the data the new sections render from — the buffer assertion alone
    // can't distinguish "section rendered" from "section skipped as null".
    expect(analysis.incomeComposition?.length).toBeGreaterThan(0);
    expect(analysis.deductionDetail?.scheduleA?.saltLostToCap).toBe(22000);

    const buffer = await renderToBuffer(
      <TaxAnalysisPdfDocument
        clientName="Sam & Casey Cooper"
        taxYear={facts.taxYear}
        generatedAt="July 12, 2026"
        analysis={analysis}
      />,
    );
    expect(buffer.length).toBeGreaterThan(2000);
  }, 30000);
});
