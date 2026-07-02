import { describe, it, expect } from "vitest";
import { PRESENTATION_PAGES } from "../registry";

describe("assumptions registration", () => {
  it("is registered under Framing with scenario override and the three toggles", () => {
    const page = PRESENTATION_PAGES.assumptions;
    expect(page).toBeDefined();
    expect(page.id).toBe("assumptions");
    expect(page.category).toBe("Framing");
    expect(page.supportsScenarioOverride).toBe(true);
    expect(page.defaultOptions).toEqual({
      includeAccountTable: true,
      includeCmaAppendix: true,
      showAccountValues: true,
    });
    expect(typeof page.buildData).toBe("function");
    expect(typeof page.renderPdf).toBe("function");
    expect(typeof page.OptionsControl).toBe("function");
  });
});
