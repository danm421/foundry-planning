import { describe, it, expect } from "vitest";
import { PRESENTATION_PAGES } from "../registry";

describe("holdings registration", () => {
  it("is registered under Assets without scenario override and with both toggles", () => {
    const page = PRESENTATION_PAGES.holdings;
    expect(page).toBeDefined();
    expect(page.id).toBe("holdings");
    expect(page.category).toBe("Assets");
    expect(page.supportsScenarioOverride).toBe(false);
    expect(page.defaultOptions).toEqual({
      groupByAccount: true,
      includeCostBasis: true,
    });
    expect(typeof page.buildData).toBe("function");
    expect(typeof page.renderPdf).toBe("function");
    expect(typeof page.OptionsControl).toBe("function");
  });

  it("estimatePageCount is data-independent", () => {
    const page = PRESENTATION_PAGES.holdings;
    expect(page.estimatePageCount(undefined as never, page.defaultOptions)).toBe(1);
  });
});
