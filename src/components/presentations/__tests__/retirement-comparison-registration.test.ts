import { describe, it, expect } from "vitest";
import { PRESENTATION_PAGES } from "../registry";

// Pins the behaviour the export route USED to hardcode by pageId, now that it
// reads the `maxSpendRefs` hook off the registry instead.
describe("retirementComparison registration", () => {
  it("still asks for a max-spend solve on base and the chosen scenario", () => {
    const p = PRESENTATION_PAGES.retirementComparison;
    expect(p.maxSpendRefs!({ ...p.defaultOptions, scenarioId: "s1" }))
      .toEqual({ refs: ["base", "s1"], targetPoS: 0.85 });
    expect(p.maxSpendRefs!({ ...p.defaultOptions, scenarioId: "" }))
      .toEqual({ refs: ["base"], targetPoS: 0.85 });
    expect(p.maxSpendRefs!({
      ...p.defaultOptions, scenarioId: "s1",
      maxSpend: { show: false, targetConfidence: 0.85 },
    })).toBeNull();
  });
});
