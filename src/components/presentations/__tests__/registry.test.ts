import { describe, it, expect } from "vitest";
import { PRESENTATION_PAGES, CATEGORY_ORDER } from "../registry";

describe("PRESENTATION_PAGES", () => {
  it("registers the cashFlow page", () => {
    expect(PRESENTATION_PAGES.cashFlow).toBeDefined();
    expect(PRESENTATION_PAGES.cashFlow.id).toBe("cashFlow");
    expect(PRESENTATION_PAGES.cashFlow.title).toBe("Cash Flow");
  });

  it("each page exposes buildData and renderPdf as functions", () => {
    for (const page of Object.values(PRESENTATION_PAGES)) {
      expect(typeof page.buildData).toBe("function");
      expect(typeof page.renderPdf).toBe("function");
      expect(page.title.length).toBeGreaterThan(0);
    }
  });

  it("each page has a category listed in CATEGORY_ORDER", () => {
    for (const page of Object.values(PRESENTATION_PAGES)) {
      expect(CATEGORY_ORDER).toContain(page.category);
    }
  });

  it("assigns each page to its own taxonomy category", () => {
    expect(PRESENTATION_PAGES.cover.category).toBe("Framing");
    expect(PRESENTATION_PAGES.toc.category).toBe("Framing");
    expect(PRESENTATION_PAGES.cashFlow.category).toBe("Cash Flow");
    expect(PRESENTATION_PAGES.cashFlowIncome.category).toBe("Cash Flow");
    // Income-tax pages share the drill-page factory with cash-flow pages but
    // carry their own category — they must NOT fall back to "Cash Flow".
    expect(PRESENTATION_PAGES.incomeTaxIncome.category).toBe("Income Tax");
    expect(PRESENTATION_PAGES.incomeTaxBracketState.category).toBe("Income Tax");
    expect(PRESENTATION_PAGES.assetAllocation.category).toBe("Assets");
    expect(PRESENTATION_PAGES.portfolioAnalysis.category).toBe("Assets");
    expect(PRESENTATION_PAGES.monteCarlo.category).toBe("Monte Carlo");
  });
});

// The launcher row renders ONE trailing scenario control per page, and the
// Generate guard reads the same two fields to decide whether a comparison is
// still unset. Both rules assume the fields are mutually exclusive; nothing in
// the types enforces it, so pin it here — a page setting both would block
// Generate over a control its row never shows.
describe("scenario-control invariants", () => {
  const pages = Object.values(PRESENTATION_PAGES);

  it("no page offers both a scenario override and an inline scenario picker", () => {
    const both = pages.filter((p) => p.supportsScenarioOverride && p.inlineScenarioOption);
    expect(both.map((p) => p.id)).toEqual([]);
  });

  it("every inline scenario picker uses the same 'Compare to…' prompt", () => {
    const inline = pages.filter((p) => p.inlineScenarioOption);
    // Guards the assertion below from passing on an empty list.
    expect(inline.length).toBeGreaterThanOrEqual(3);
    for (const p of inline) {
      expect(p.inlineScenarioOption!.placeholder).toBe("Compare to…");
    }
  });

  // Every comparison report compares a scenario against Base Case, so none of
  // them may take the deck's per-page scenario override ("base facts").
  it("every Comparison report picks its scenario inline, never by override", () => {
    const comparison = pages.filter((p) => p.category === "Comparison");
    expect(comparison.length).toBeGreaterThanOrEqual(3);
    for (const p of comparison) {
      expect({ id: p.id, override: p.supportsScenarioOverride, inline: !!p.inlineScenarioOption })
        .toEqual({ id: p.id, override: false, inline: true });
    }
  });
});

describe("blank page registration", () => {
  it("registers the blank page under Framing with no scenario override", () => {
    expect(PRESENTATION_PAGES.blank.category).toBe("Framing");
    expect(PRESENTATION_PAGES.blank.supportsScenarioOverride).toBe(false);
    expect(PRESENTATION_PAGES.blank.defaultOptions).toEqual({ markdown: "" });
  });
});

describe("estateSummary registration", () => {
  it("is registered in the Estate category", () => {
    const page = PRESENTATION_PAGES.estateSummary;
    expect(page).toBeDefined();
    expect(page.id).toBe("estateSummary");
    expect(page.category).toBe("Estate");
  });
  it("estimatePageCount is data-independent (callable with undefined data)", () => {
    const page = PRESENTATION_PAGES.estateSummary;
    expect(page.estimatePageCount(undefined as never, page.defaultOptions)).toBe(1);
  });
  it("defaultOptions parse against the schema", () => {
    const page = PRESENTATION_PAGES.estateSummary;
    expect(() => page.optionsSchema.parse(page.defaultOptions)).not.toThrow();
  });
});
