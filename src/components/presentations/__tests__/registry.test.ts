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
