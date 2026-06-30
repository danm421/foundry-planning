import { describe, it, expect } from "vitest";
import {
  taxComparisonOptionsSchema,
  TAX_COMPARISON_OPTIONS_DEFAULT,
} from "../options-schema";
import { summarizeTaxComparisonOptions } from "../summarize-options";
import { estimateTaxComparisonPageCount } from "../estimate-page-count";

describe("tax-comparison options", () => {
  it("parses default options", () => {
    expect(() => taxComparisonOptionsSchema.parse(TAX_COMPARISON_OPTIONS_DEFAULT)).not.toThrow();
    expect(TAX_COMPARISON_OPTIONS_DEFAULT).toEqual({ scenarioId: "", lowThreshold: 0.22, highThreshold: 0.24 });
  });

  it("summarizes thresholds, noting when no scenario is picked", () => {
    expect(summarizeTaxComparisonOptions(TAX_COMPARISON_OPTIONS_DEFAULT)).toBe("No scenario · Low <22% · High >24%");
    expect(summarizeTaxComparisonOptions({ scenarioId: "s1", lowThreshold: 0.22, highThreshold: 0.24 })).toBe("vs scenario · Low <22% · High >24%");
  });

  it("estimates one page", () => {
    expect(estimateTaxComparisonPageCount()).toBe(1);
  });
});
