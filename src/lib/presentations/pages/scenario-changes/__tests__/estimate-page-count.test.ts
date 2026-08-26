import { describe, it, expect } from "vitest";
import { estimateScenarioChangesPageCount } from "../estimate-page-count";
import { scenarioChangesOptionsSchema, SCENARIO_CHANGES_OPTIONS_DEFAULT } from "../options-schema";
import { summarizeScenarioChangesOptions } from "../summarize-options";

describe("scenario-changes options + estimate", () => {
  it("estimate is data-independent (takes no args, like every sibling)", () => {
    expect(estimateScenarioChangesPageCount()).toBe(2);
  });

  it("schema parses the default options", () => {
    expect(scenarioChangesOptionsSchema.parse(SCENARIO_CHANGES_OPTIONS_DEFAULT)).toEqual(SCENARIO_CHANGES_OPTIONS_DEFAULT);
  });

  it("summarize reflects the chosen scenario and the explanations toggle", () => {
    expect(summarizeScenarioChangesOptions({ scenarioId: "s9", title: "X", showExplanations: true }))
      .toBe("vs Base Case · With details");
    expect(summarizeScenarioChangesOptions({ scenarioId: "s9", title: "X", showExplanations: false }))
      .toBe("vs Base Case · Changes only");
    expect(summarizeScenarioChangesOptions({ scenarioId: "", title: "X", showExplanations: true }))
      .toBe("No scenario selected · With details");
  });
});
