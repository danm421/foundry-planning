import { describe, it, expect } from "vitest";
import { PRESENTATION_PAGES } from "../registry";

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
});
