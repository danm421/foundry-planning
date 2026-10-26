import { describe, it, expect } from "vitest";
import { retirementSummaryOptionsSchema, RETIREMENT_SUMMARY_OPTIONS_DEFAULT } from "../options-schema";
import { summarizeRetirementSummaryOptions } from "../summarize-options";

describe("retirement summary options", () => {
  it("defaults the max-spend KPI to off at 85% for a deck saved before it existed", () => {
    expect(retirementSummaryOptionsSchema.parse({})).toEqual(RETIREMENT_SUMMARY_OPTIONS_DEFAULT);
    expect(RETIREMENT_SUMMARY_OPTIONS_DEFAULT.maxSpend).toEqual({ show: false, targetConfidence: 0.85 });
  });

  it("names the confidence target in the row summary only when the KPI is on", () => {
    expect(summarizeRetirementSummaryOptions(RETIREMENT_SUMMARY_OPTIONS_DEFAULT)).toBe("Lifetime funding · SS 62–70");
    expect(
      summarizeRetirementSummaryOptions({ maxSpend: { show: true, targetConfidence: 0.9 } }),
    ).toBe("Lifetime funding · SS 62–70 · Max spend at 90%");
  });

  it("summarizes a saved template's raw options, which may predate the setting", () => {
    // Saved templates reach the launcher row unparsed.
    expect(summarizeRetirementSummaryOptions({} as never)).toBe("Lifetime funding · SS 62–70");
  });
});
