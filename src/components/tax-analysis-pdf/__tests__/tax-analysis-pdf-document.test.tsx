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
});
