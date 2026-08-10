import { describe, it, expect } from "vitest";
import { renderToBuffer } from "@react-pdf/renderer";
import { TaxAnalysisPdfDocument } from "../tax-analysis-pdf-document";
import { buildTaxAnalysis } from "@/lib/tax-analysis/analysis";
import { createTaxResolver } from "@/lib/tax/resolver";
import {
  params2025,
  retireeMfj,
  highEarnerMfj,
  landlordSingle,
  sCorpOwnerMfj,
} from "@/lib/tax-analysis/__tests__/fixtures";
import { incomeCompositionTotal } from "@/lib/tax-analysis/breakdowns";
import { activityDetailRows } from "@/lib/tax-analysis/activity-detail";
import { emptyBusiness, emptyK1 } from "@/lib/schemas/tax-return-facts";
import { sortFindings } from "@/lib/tax-analysis/findings/order";
import { formatLineRefs } from "@/lib/tax-analysis/findings/line-refs";
import { extractPdfText } from "@/lib/extraction/pdf-parser";

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
    // The retiree fixture's SS is 62,000 gross / 52,700 taxable, so the gross
    // tile and the Gross column both render on this page.
    expect(analysis.keyFigures.grossIncome).toBe(205000);
    expect(incomeCompositionTotal(analysis.keyFigures.totalIncome, analysis.keyFigures.grossIncome)).toEqual({
      amount: "$195,700", gross: "$205,000", pct: "100%",
    });

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

  it("renders four-part finding cards on paper, sorted at the call site, with an uppercase category chip and a line-ref footer", async () => {
    const facts = sCorpOwnerMfj();
    const analysis = buildTaxAnalysis({ facts, prior: null, resolver, primaryAge: 51, spouseAge: 49 });
    // Captured BEFORE sortFindings runs, so an in-place mutation of
    // analysis.findings (shared with the screen) would show up below as a
    // reordering of this array rather than being silently missed.
    const buildOrderIds = analysis.findings.map((f) => f.id);

    // The buffer assertion alone can't tell "cards rendered" from "section
    // skipped": guard the data, and guard that a card carries all four parts
    // plus a footer, because an unknown react-pdf style key throws at RENDER.
    const findings = sortFindings(analysis.findings);
    expect(findings.map((f) => f.id)).toContain("qbi-phaseout-position");
    expect(findings.map((f) => f.id)).toContain("reasonable-compensation");
    const withRefs = findings.filter((f) => formatLineRefs(f.lineRefs) !== "");
    expect(withRefs.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.estimatedImpact != null)).toBe(true);

    const buffer = await renderToBuffer(
      <TaxAnalysisPdfDocument
        clientName="Ridgeline Owner"
        taxYear={facts.taxYear}
        generatedAt="August 8, 2026"
        analysis={analysis}
      />,
    );
    expect(buffer.length).toBeGreaterThan(2000);

    // sortFindings returns a new array — analysis.findings itself (shared
    // with the screen renderer) must be untouched by the render above.
    expect(analysis.findings.map((f) => f.id)).toEqual(buildOrderIds);

    // Everything above is data-layer (order.ts / line-refs.ts). None of it
    // can tell "FindingsSection rendered cards" from "FindingsSection
    // returned null" — assert the REAL RENDERED TEXT to close that gap.
    const text = (await extractPdfText(Buffer.from(buffer))).replace(/\s+/g, " ");

    // The four-part labels are styled uppercase (findingPartLabel).
    expect(text).toContain("WHAT THE RETURN SHOWS");
    expect(text).toContain("WHY IT MATTERS");
    expect(text).toContain("WHAT TO CONSIDER");

    // The category chip is uppercase too (findingCategory). "RETIREMENT" is
    // a clean, case-sensitive, non-vacuous match — "BUSINESS" already
    // appears via the "Business & rental detail" section heading, so it
    // can't discriminate a rendered chip from an unrelated heading.
    expect(text).toContain("RETIREMENT");

    // A line-ref footer is genuinely new: today's render has none.
    expect(text).toContain(
      "Schedule K-1 (Form 1065) — Harbor Street Partners LP box 4 · Schedule 2 line 4",
    );

    // sortFindings must be applied AT THIS CALL SITE, not merely available to
    // it (the exact defect Task 11's reviewer caught, where swapping
    // sortFindings(a.findings) for a.findings left 254/254 green). The PDF
    // has no jump-link index, so display order is only observable through
    // the extracted text — pin the sequence against a HARD-CODED expected
    // order, never one derived by calling sortFindings inside this
    // assertion. This also guards against a card vanishing outright: a
    // dropped FindingCard would be missing its headline here. It does NOT
    // guard an over-tall wrap={false} card that overflows a page — react-pdf
    // does not drop that card; it starts a fresh page and CLIPS THE TAIL, so
    // the headline (at the top of the card) survives every time. See the
    // tail assertion below for that failure mode.
    const expectedOrder = [
      "No self-employed retirement plan against $60,000 of SE income",
      "QBI deduction capped $10,400 below the full 20%",
      "$63,289 of Roth conversion room at 32%",
      "No self-employed health insurance deduction against SE income",
      "$310,000 of Ridgeline Systems Inc income passed through against $120,000 of owner wages",
      "$60,000 of guaranteed payments carry about $8,478 of self-employment tax",
      "Ordinary income tops out in the 32% bracket",
      "$7,688 due at filing, though the safe harbor was met",
      "About $69,304 of MN income tax on this return's income",
    ];
    const indices = expectedOrder.map((headline) => text.indexOf(headline));
    indices.forEach((idx, i) => {
      expect(idx, `missing headline: ${expectedOrder[i]}`).toBeGreaterThan(-1);
    });
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }

    // The real wrap={false} overflow failure mode is a CLIPPED TAIL, not a
    // dropped card — an over-tall card starts on a fresh page and whatever
    // doesn't fit is truncated, so the headline above always survives even
    // when the card's own ending does not (verified empirically: at 8,489+
    // chars of padding the headline still renders while the tail is
    // dropped). qbi-phaseout-position is the tallest card this fixture
    // renders — headline + all four parts + refs footer, 1,291 chars, taller
    // than any other card in any fixture — so pin its last part's tail
    // immediately followed by its own refs footer. If either the tail or the
    // footer were clipped, this single contiguous match would not be found.
    expect(text).toContain(
      "entity has the wages and another the income. Form 1040 line 13 · line 15 · Form 8995 qualified business income · Form 8995-A line 19",
    );

    // The label->body pairing is unpinned by a bare toContain on the three
    // labels — swapping the "Why it matters" / "What to consider" labels in
    // FINDING_PARTS leaves the suite green, because "the label exists
    // somewhere" and "the body exists somewhere" are both still true. Assert
    // each label immediately followed by the start of its OWN body, so a
    // label sitting over the wrong prose reddens.
    expect(text).toContain(
      "WHAT THE RETURN SHOWS The return reports $60,000 of partnership guaranteed payments",
    );
    expect(text).toContain(
      "WHY IT MATTERS Self-employment income supports a far larger deductible contribution",
    );

    // The impact chip is unpinned by "some finding has a non-null
    // estimatedImpact" — every impact figure also appears inside the card's
    // own prose, so a bare toContain(fmtUsd(impact)) can't tell the chip from
    // the sentence quoting it. The chip sits in the text layer immediately
    // between the headline and the category chip, so pin BOTH halves of the
    // `estimatedImpact != null` conditional by adjacency: present between
    // headline and chip when an impact exists, absent (headline runs
    // straight into the category chip) when it doesn't.
    expect(text).toContain(
      "No self-employed retirement plan against $60,000 of SE income $12,821 RETIREMENT",
    );
    expect(text).toContain(
      "No self-employed health insurance deduction against SE income BUSINESS",
    );
  }, 30000);
});
