import { describe, it, expect } from "vitest";
import {
  assumptionsOptionsSchema,
  ASSUMPTIONS_OPTIONS_DEFAULT,
} from "../options-schema";
import { summarizeAssumptionsOptions } from "../summarize-options";

describe("assumptions options", () => {
  it("defaults every section on", () => {
    expect(ASSUMPTIONS_OPTIONS_DEFAULT).toEqual({
      includeAccountTable: true,
      includeCmaAppendix: true,
      showAccountValues: true,
    });
    expect(assumptionsOptionsSchema.parse({})).toEqual(ASSUMPTIONS_OPTIONS_DEFAULT);
  });

  it("summarizes the enabled sections", () => {
    expect(summarizeAssumptionsOptions(ASSUMPTIONS_OPTIONS_DEFAULT)).toBe("Overview · accounts · CMA");
    expect(
      summarizeAssumptionsOptions({ includeAccountTable: false, includeCmaAppendix: false, showAccountValues: true }),
    ).toBe("Overview");
  });
});
