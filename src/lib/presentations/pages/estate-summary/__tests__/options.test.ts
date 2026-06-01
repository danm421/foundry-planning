import { describe, it, expect } from "vitest";
import {
  estateSummaryOptionsSchema,
  ESTATE_SUMMARY_OPTIONS_DEFAULT,
} from "../options-schema";
import { summarizeEstateSummaryOptions } from "../summarize-options";
import { estimateEstateSummaryPageCount } from "../estimate-page-count";

describe("estate-summary options + estimate", () => {
  it("default is primaryFirst", () => {
    expect(ESTATE_SUMMARY_OPTIONS_DEFAULT).toEqual({ ordering: "primaryFirst" });
  });

  it("schema.parse({}) yields the default", () => {
    expect(estateSummaryOptionsSchema.parse({})).toEqual({
      ordering: "primaryFirst",
    });
  });

  it("schema accepts spouseFirst", () => {
    expect(estateSummaryOptionsSchema.parse({ ordering: "spouseFirst" })).toEqual({
      ordering: "spouseFirst",
    });
  });

  it("schema rejects invalid ordering", () => {
    expect(() => estateSummaryOptionsSchema.parse({ ordering: "nope" })).toThrow();
  });

  it("summarize returns 'Primary dies first' for primaryFirst", () => {
    expect(summarizeEstateSummaryOptions({ ordering: "primaryFirst" })).toBe(
      "Primary dies first"
    );
  });

  it("summarize returns 'Spouse dies first' for spouseFirst", () => {
    expect(summarizeEstateSummaryOptions({ ordering: "spouseFirst" })).toBe(
      "Spouse dies first"
    );
  });

  it("estimate is data-independent (takes no args, like every sibling)", () => {
    expect(estimateEstateSummaryPageCount()).toBe(1);
  });
});
