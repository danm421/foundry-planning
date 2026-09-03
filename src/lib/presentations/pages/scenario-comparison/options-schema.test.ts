import { describe, it, expect } from "vitest";
import {
  scenarioComparisonOptionsSchema,
  SCENARIO_COMPARISON_OPTIONS_DEFAULT,
} from "./options-schema";

describe("scenarioComparisonOptionsSchema", () => {
  it("round-trips the defaults", () => {
    expect(() =>
      scenarioComparisonOptionsSchema.parse(SCENARIO_COMPARISON_OPTIONS_DEFAULT),
    ).not.toThrow();
  });

  it("defaults scenarioIds to [] when the field is absent", () => {
    const legacy = {
      maxSpend: { show: true, targetConfidence: 0.85 },
      showChart: true,
      showTradeoffBands: true,
      ai: { tone: "detailed", customInstructions: "" },
    };
    const parsed = scenarioComparisonOptionsSchema.parse(legacy);
    expect(parsed.scenarioIds).toEqual([]);
    expect(parsed.ai.byScenario).toEqual({});
  });

  it("rejects a fourth scenario id", () => {
    expect(() =>
      scenarioComparisonOptionsSchema.parse({
        ...SCENARIO_COMPARISON_OPTIONS_DEFAULT,
        scenarioIds: ["a", "b", "c", "d"],
      }),
    ).toThrow();
  });

  it("keeps a stored band narrative", () => {
    const parsed = scenarioComparisonOptionsSchema.parse({
      ...SCENARIO_COMPARISON_OPTIONS_DEFAULT,
      scenarioIds: ["s1"],
      ai: {
        tone: "plain",
        customInstructions: "",
        byScenario: { s1: { generatedText: "hi", generatedAt: null, sourceHash: "h" } },
      },
    });
    expect(parsed.ai.byScenario.s1.generatedText).toBe("hi");
  });
});
