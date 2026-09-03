import { describe, it, expect } from "vitest";
import { PRESENTATION_PAGES } from "../registry";

const page = PRESENTATION_PAGES.scenarioComparison;

describe("scenarioComparison registration", () => {
  it("is a Comparison page with no base-facts override", () => {
    expect(page.id).toBe("scenarioComparison");
    expect(page.title).toBe("Scenario Comparison");
    expect(page.category).toBe("Comparison");
    expect(page.supportsScenarioOverride).toBe(false);
    // Its picker is a LIST in the dialog, not the row's single-select.
    expect(page.inlineScenarioOption).toBeUndefined();
  });

  it("requires base plus each chosen scenario", () => {
    expect(page.requiredScenarioRefs!({ ...page.defaultOptions, scenarioIds: [] }))
      .toEqual(["base"]);
    expect(page.requiredScenarioRefs!({ ...page.defaultOptions, scenarioIds: ["a", "b"] }))
      .toEqual(["base", "a", "b"]);
  });

  it("reports itself unconfigured until a scenario is chosen", () => {
    expect(page.isUnconfigured!({ ...page.defaultOptions, scenarioIds: [] })).toBe(true);
    expect(page.isUnconfigured!({ ...page.defaultOptions, scenarioIds: ["a"] })).toBe(false);
  });

  it("asks for a max-spend solve on every column, and none when the row is off", () => {
    expect(page.maxSpendRefs!({ ...page.defaultOptions, scenarioIds: ["a", "b"] }))
      .toEqual({ refs: ["base", "a", "b"], targetPoS: 0.85 });
    expect(page.maxSpendRefs!({
      ...page.defaultOptions, scenarioIds: ["a"],
      maxSpend: { show: false, targetConfidence: 0.85 },
    })).toBeNull();
  });

  it("defaultOptions parse against the schema", () => {
    expect(() => page.optionsSchema.parse(page.defaultOptions)).not.toThrow();
  });

  it("names both sheets in the Contents when the tradeoffs sheet prints", () => {
    expect(page.tocSections!({ isEmpty: false, bands: [{}, {}] } as never, page.defaultOptions))
      .toEqual([
        { title: "Scenario Comparison", offset: 0 },
        { title: "Scenario Comparison — tradeoffs", offset: 1 },
      ]);
  });

  it("names one sheet in the Contents for the empty state", () => {
    expect(page.tocSections!({ isEmpty: true, bands: [] } as never, page.defaultOptions))
      .toEqual([{ title: "Scenario Comparison", offset: 0 }]);
  });

  it("names one sheet when the tradeoffs sheet is dropped (bands empty, not empty state)", () => {
    expect(page.tocSections!({ isEmpty: false, bands: [] } as never, page.defaultOptions))
      .toEqual([{ title: "Scenario Comparison", offset: 0 }]);
  });
});
