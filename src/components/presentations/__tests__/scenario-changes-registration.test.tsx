import { describe, it, expect } from "vitest";
import { PRESENTATION_PAGES } from "../registry";

describe("Plan Comparison (scenarioChanges) registration", () => {
  const page = PRESENTATION_PAGES.scenarioChanges;

  // The report compares a scenario against Base Case, so the deck's per-page
  // scenario picker ("base facts", a snapshot, another scenario) has nothing to
  // offer it — it must behave like its Retirement / Tax Comparison siblings.
  it("is registered under the Comparison category with a Base-Case baseline", () => {
    expect(page.id).toBe("scenarioChanges");
    expect(page.title).toBe("Plan Comparison");
    expect(page.category).toBe("Comparison");
    expect(page.supportsScenarioOverride).toBe(false);
  });

  it("exposes an inline 'Compare to…' scenario picker", () => {
    expect(page.inlineScenarioOption).toBeDefined();
    expect(page.inlineScenarioOption!.placeholder).toBe("Compare to…");
    const set = page.inlineScenarioOption!.set(page.defaultOptions, "s9");
    expect(page.inlineScenarioOption!.get(set)).toBe("s9");
  });

  // Deliberately narrower than Retirement / Tax Comparison, which name "base"
  // because they print base figures beside the scenario's. This sheet lists the
  // scenario's own edits — already recorded relative to base — so loading the
  // base tree would be an unread projection and one less deck slot.
  it("requires only the chosen scenario, never the base ref", () => {
    expect(page.requiredScenarioRefs!(page.defaultOptions)).toEqual([]);
    expect(page.requiredScenarioRefs!({ ...page.defaultOptions, scenarioId: "s9" })).toEqual(["s9"]);
  });

  it("parses its default options, and options saved before the scenario existed", () => {
    expect(() => page.optionsSchema.parse(page.defaultOptions)).not.toThrow();
    // A template stored before this report required a scenario has no
    // scenarioId; it must still load, landing on the "pick one" state.
    const legacy = page.optionsSchema.parse({ title: "Plan Comparison", showExplanations: true });
    expect((legacy as { scenarioId: string }).scenarioId).toBe("");
  });
});
