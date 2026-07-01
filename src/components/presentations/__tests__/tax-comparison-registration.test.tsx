import { describe, it, expect } from "vitest";
import { PRESENTATION_PAGES } from "../registry";

describe("taxComparison registration", () => {
  const page = PRESENTATION_PAGES.taxComparison;

  it("is registered under the Comparison category with a Base-Case baseline", () => {
    expect(page).toBeDefined();
    expect(page.id).toBe("taxComparison");
    expect(page.title).toBe("Tax Comparison");
    expect(page.category).toBe("Comparison");
    expect(page.supportsScenarioOverride).toBe(false);
  });

  it("exposes an inline 'Compare to…' scenario picker", () => {
    expect(page.inlineScenarioOption).toBeDefined();
    expect(page.inlineScenarioOption!.placeholder).toBe("Compare to…");
    const set = page.inlineScenarioOption!.set(page.defaultOptions, "s9");
    expect(page.inlineScenarioOption!.get(set)).toBe("s9");
  });

  it("requires the base ref alone until a scenario is chosen", () => {
    expect(page.requiredScenarioRefs!(page.defaultOptions)).toEqual(["base"]);
    expect(page.requiredScenarioRefs!({ ...page.defaultOptions, scenarioId: "s9" })).toEqual(["base", "s9"]);
  });

  it("parses its default options and estimates one page", () => {
    expect(() => page.optionsSchema.parse(page.defaultOptions)).not.toThrow();
    expect(page.estimatePageCount(undefined as never, page.defaultOptions)).toBe(1);
  });
});
