import { describe, it, expect } from "vitest";
import { estimateScenarioChangesPageCount } from "../estimate-page-count";
import { scenarioChangesOptionsSchema, SCENARIO_CHANGES_OPTIONS_DEFAULT } from "../options-schema";
import { summarizeScenarioChangesOptions } from "../summarize-options";

describe("scenario-changes options + estimate", () => {
  it("estimate is data-independent (takes no args, like every sibling)", () => {
    expect(estimateScenarioChangesPageCount()).toBe(1);
  });

  it("schema parses the default options", () => {
    expect(scenarioChangesOptionsSchema.parse(SCENARIO_CHANGES_OPTIONS_DEFAULT)).toEqual(SCENARIO_CHANGES_OPTIONS_DEFAULT);
  });

  it("summarize reflects the explanations toggle", () => {
    expect(summarizeScenarioChangesOptions({ title: "X", showExplanations: true })).toBe("With details");
    expect(summarizeScenarioChangesOptions({ title: "X", showExplanations: false })).toBe("Changes only");
  });
});
