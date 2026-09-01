import { describe, it, expect } from "vitest";
import { estimateScenarioChangesPageCount } from "../estimate-page-count";
import { scenarioChangesOptionsSchema, SCENARIO_CHANGES_OPTIONS_DEFAULT } from "../options-schema";
import { summarizeScenarioChangesOptions } from "../summarize-options";

describe("scenario-changes options + estimate", () => {
  // The count is data-DRIVEN now: a fixed 2 shifted every Contents entry after
  // this page whenever the table did not happen to need two sheets. The
  // constants it divides by are pinned against real renders in
  // components/presentations/pages/scenario-changes/estimate-page-count.test.tsx.
  it("answers one sheet for a data-free probe, as the registry contract allows", () => {
    expect(estimateScenarioChangesPageCount()).toBe(1);
  });

  it("grows with the table", () => {
    const units = Array.from({ length: 40 }, (_, i) => ({
      kind: "row" as const,
      row: {
        area: "Income" as const, what: `Change ${i}`, op: "edit" as const,
        before: "$1", after: "$2", detail: ["one detail line"],
      },
    }));
    const data = { title: "Plan Comparison", subtitle: "", units, showExplanations: true, isEmpty: false };
    expect(estimateScenarioChangesPageCount(data)).toBeGreaterThan(
      estimateScenarioChangesPageCount({ ...data, units: units.slice(0, 5) }),
    );
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
