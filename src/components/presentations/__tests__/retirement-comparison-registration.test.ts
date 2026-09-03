import { describe, it, expect } from "vitest";
import { PRESENTATION_PAGES } from "../registry";

// Two guarantees meet on this page's registration:
//   1. the export route no longer hardcodes max-spend by pageId — it reads the
//      `maxSpendRefs` hook off the registry;
//   2. both ref hooks name the advisor's CHOSEN baseline, not the literal
//      "base". They share one helper so they cannot drift: the view model hides
//      the max-spend panel and its page-1 KPI whenever either side's solve is
//      missing, so a solve attached to the wrong ref deletes a panel and a card
//      from a client-facing deck with nothing on screen to say so.
describe("retirementComparison registration", () => {
  const p = PRESENTATION_PAGES.retirementComparison;

  it("defaults to the Base Case baseline, preserving today's behaviour", () => {
    expect(p.requiredScenarioRefs!(p.defaultOptions)).toEqual(["base"]);
    expect(p.requiredScenarioRefs!({ ...p.defaultOptions, scenarioId: "s9" })).toEqual([
      "base",
      "s9",
    ]);
  });

  it("asks for the chosen baseline instead of always asking for base", () => {
    expect(
      p.requiredScenarioRefs!({ ...p.defaultOptions, baselineScenarioId: "s1", scenarioId: "s9" }),
    ).toEqual(["s1", "s9"]);
  });

  it("exposes the baseline id to the launcher row", () => {
    expect(p.readBaselineScenarioId!(p.defaultOptions)).toBe("base");
    expect(p.readBaselineScenarioId!({ ...p.defaultOptions, baselineScenarioId: "s1" })).toBe("s1");
  });

  it("still asks for a max-spend solve on base and the chosen scenario", () => {
    expect(p.maxSpendRefs!({ ...p.defaultOptions, scenarioId: "s1" })).toEqual({
      refs: ["base", "s1"],
      targetPoS: 0.85,
    });
    expect(p.maxSpendRefs!({ ...p.defaultOptions, scenarioId: "" })).toEqual({
      refs: ["base"],
      targetPoS: 0.85,
    });
    expect(
      p.maxSpendRefs!({
        ...p.defaultOptions,
        scenarioId: "s1",
        maxSpend: { show: false, targetConfidence: 0.85 },
      }),
    ).toBeNull();
  });

  // The one that would have caught the shipped bug: the solve must move with
  // the baseline, never stay pinned to "base".
  it("solves the chosen baseline, so the panel survives a scenario baseline", () => {
    expect(
      p.maxSpendRefs!({ ...p.defaultOptions, baselineScenarioId: "s1", scenarioId: "s9" }),
    ).toEqual({ refs: ["s1", "s9"], targetPoS: 0.85 });
  });

  it("names the same refs for the solve as for the columns it prints", () => {
    const o = { ...p.defaultOptions, baselineScenarioId: "s1", scenarioId: "s9" };
    expect(p.maxSpendRefs!(o)!.refs).toEqual(p.requiredScenarioRefs!(o));
  });
});
