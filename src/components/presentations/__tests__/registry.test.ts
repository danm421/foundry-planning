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

  it("cover and toc are Framing; cash-flow pages are Cash Flow", () => {
    expect(PRESENTATION_PAGES.cover.category).toBe("Framing");
    expect(PRESENTATION_PAGES.toc.category).toBe("Framing");
    expect(PRESENTATION_PAGES.cashFlow.category).toBe("Cash Flow");
    expect(PRESENTATION_PAGES.cashFlowIncome.category).toBe("Cash Flow");
  });
});
