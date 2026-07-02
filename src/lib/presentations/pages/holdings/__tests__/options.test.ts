import { describe, it, expect } from "vitest";
import {
  holdingsOptionsSchema,
  HOLDINGS_OPTIONS_DEFAULT,
} from "../options-schema";
import { summarizeHoldingsOptions } from "../summarize-options";
import { estimateHoldingsPageCount } from "../estimate-page-count";

describe("holdings options schema", () => {
  it("parses an empty object to the defaults", () => {
    expect(holdingsOptionsSchema.parse({})).toEqual(HOLDINGS_OPTIONS_DEFAULT);
  });

  it("defaults to grouped with cost basis on", () => {
    expect(HOLDINGS_OPTIONS_DEFAULT).toEqual({
      groupByAccount: true,
      includeCostBasis: true,
    });
  });
});

describe("summarizeHoldingsOptions", () => {
  it("names the layout and cost-basis state", () => {
    expect(summarizeHoldingsOptions(HOLDINGS_OPTIONS_DEFAULT)).toBe("By account · cost basis");
    expect(summarizeHoldingsOptions({ groupByAccount: false, includeCostBasis: false })).toBe("All holdings");
  });
});

describe("estimateHoldingsPageCount", () => {
  it("is data-independent and returns 1", () => {
    // Zero-arg like the asset-allocation sibling; the registry slot still
    // types it as (data, options) => number, so exercise it through that shape.
    const asRegistrySlot: (data: unknown, options: unknown) => number =
      estimateHoldingsPageCount;
    expect(asRegistrySlot(undefined, HOLDINGS_OPTIONS_DEFAULT)).toBe(1);
    expect(asRegistrySlot(undefined, { groupByAccount: false, includeCostBasis: false })).toBe(1);
  });
});
