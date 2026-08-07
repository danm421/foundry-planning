import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { TaxAnalysisPdfDocument } from "../tax-analysis-pdf-document";
import { buildTaxAnalysis } from "@/lib/tax-analysis/analysis";
import { createTaxResolver } from "@/lib/tax/resolver";
import { params2025, retireeMfj, highEarnerMfj, landlordSingle } from "@/lib/tax-analysis/__tests__/fixtures";
import { incomeCompositionTotal } from "@/lib/tax-analysis/breakdowns";
import { activityDetailRows } from "@/lib/tax-analysis/activity-detail";
import { emptyBusiness, emptyK1 } from "@/lib/schemas/tax-return-facts";

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

  it("renders the business & rental detail section across all three activity kinds", async () => {
    const facts = landlordSingle();
    facts.businesses = [{
      ...emptyBusiness(),
      name: "Acme Consulting", grossReceipts: 240000, totalExpenses: 85000,
      depreciation: 12000, netProfit: 155000,
    }];
    facts.k1s = [{
      ...emptyK1(),
      entityName: "Harbor Partners LP", ein: "12-3456789", entityType: "partnership",
      ordinaryBusinessIncome: 48000, section179: 5000,
    }];
    const analysis = buildTaxAnalysis({ facts, prior: null, resolver, primaryAge: 41, spouseAge: null });
    // The buffer assertion alone can't tell "section rendered" from "skipped as
    // null", and every line variant (primary/detail/total/memo) must be
    // exercised — an unknown react-pdf style key throws at render, not at build.
    const activities = analysis.activityDetail!;
    expect(activities.map((a) => a.title)).toEqual([
      "Acme Consulting", "Rental real estate", "Harbor Partners LP",
    ]);
    const variants = new Set(activities.flatMap((a) => activityDetailRows(a).map((r) => r.variant)));
    expect([...variants].sort()).toEqual(["detail", "memo", "primary", "total"]);

    const buffer = await renderToBuffer(
      <TaxAnalysisPdfDocument
        clientName="Dan Mueller"
        taxYear={facts.taxYear}
        generatedAt="August 7, 2026"
        analysis={analysis}
      />,
    );
    expect(buffer.length).toBeGreaterThan(2000);
  }, 30000);

  it("renders a non-trivial PDF with the Total income figure + total row when line 9 is present", async () => {
    const facts = retireeMfj();
    facts.income.totalIncome = 195700;
    facts.income.adjustmentsToIncome = 7000;
    const analysis = buildTaxAnalysis({ facts, prior: null, resolver, primaryAge: 72, spouseAge: 72 });
    // Guard the data the new KPI + total row render from — the buffer assertion
    // alone can't distinguish "rendered" from "skipped as —/null".
    expect(analysis.keyFigures.totalIncome).toBe(195700);
    expect(incomeCompositionTotal(analysis.keyFigures.totalIncome)).toEqual({ amount: "$195,700", pct: "100%" });

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
