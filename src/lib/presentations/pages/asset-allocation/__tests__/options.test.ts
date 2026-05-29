import { describe, it, expect } from "vitest";
import { assetAllocationOptionsSchema, ASSET_ALLOCATION_OPTIONS_DEFAULT } from "../options-schema";
import { summarizeAssetAllocationOptions } from "../summarize-options";

describe("assetAllocationOptionsSchema", () => {
  it("accepts the default options", () => {
    expect(assetAllocationOptionsSchema.parse(ASSET_ALLOCATION_OPTIONS_DEFAULT)).toEqual(ASSET_ALLOCATION_OPTIONS_DEFAULT);
  });
  it("rejects an unknown view", () => {
    expect(() => assetAllocationOptionsSchema.parse({ ...ASSET_ALLOCATION_OPTIONS_DEFAULT, view: "nope" })).toThrow();
  });
});

describe("summarizeAssetAllocationOptions", () => {
  it("summarizes group + view + table", () => {
    const s = summarizeAssetAllocationOptions({ groupKey: "all-liquid", view: "detailed", includeOutOfEstate: false, showTable: true });
    expect(s).toContain("By class");
    expect(s.toLowerCase()).toContain("table");
  });
});
