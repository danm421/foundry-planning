import { describe, it, expect } from "vitest";
import {
  assetAllocationOptionsSchema,
  ASSET_ALLOCATION_OPTIONS_DEFAULT,
  normalizeAssetAllocationOptions,
} from "../options-schema";
import { summarizeAssetAllocationOptions } from "../summarize-options";

describe("assetAllocationOptionsSchema", () => {
  it("accepts the default options", () => {
    expect(assetAllocationOptionsSchema.parse(ASSET_ALLOCATION_OPTIONS_DEFAULT)).toEqual(ASSET_ALLOCATION_OPTIONS_DEFAULT);
  });
  it("rejects an unknown view", () => {
    expect(() => assetAllocationOptionsSchema.parse({ ...ASSET_ALLOCATION_OPTIONS_DEFAULT, view: "nope" })).toThrow();
  });
  it("accepts a null right (single donut)", () => {
    const parsed = assetAllocationOptionsSchema.parse({ ...ASSET_ALLOCATION_OPTIONS_DEFAULT, right: null });
    expect(parsed.right).toBeNull();
  });
  it("accepts a portfolio source on either side", () => {
    const parsed = assetAllocationOptionsSchema.parse({
      ...ASSET_ALLOCATION_OPTIONS_DEFAULT,
      left: { kind: "portfolio", id: "mp1" },
      right: { kind: "group", id: "taxable" },
    });
    expect(parsed.left).toEqual({ kind: "portfolio", id: "mp1" });
    expect(parsed.right).toEqual({ kind: "group", id: "taxable" });
  });
  it("migrates the legacy { groupKey } shape to left/right", () => {
    const parsed = assetAllocationOptionsSchema.parse({
      groupKey: "taxable", view: "combined", includeOutOfEstate: true, showTable: false,
    });
    expect(parsed.left).toEqual({ kind: "group", id: "taxable" });
    expect(parsed.right).toEqual({ kind: "recommended" });
    expect(parsed.view).toBe("combined");
    expect(parsed.includeOutOfEstate).toBe(true);
    expect(parsed.showTable).toBe(false);
  });
});

describe("normalizeAssetAllocationOptions", () => {
  it("fills defaults for a legacy blob and strips groupKey", () => {
    const n = normalizeAssetAllocationOptions({ groupKey: "taxable" });
    expect(n.left).toEqual({ kind: "group", id: "taxable" });
    expect(n.right).toEqual({ kind: "recommended" });
    expect("groupKey" in n).toBe(false);
  });
  it("returns the default on garbage input", () => {
    expect(normalizeAssetAllocationOptions(42)).toEqual(ASSET_ALLOCATION_OPTIONS_DEFAULT);
  });
  it("preserves an explicit null right", () => {
    const n = normalizeAssetAllocationOptions({ ...ASSET_ALLOCATION_OPTIONS_DEFAULT, right: null });
    expect(n.right).toBeNull();
  });
});

describe("summarizeAssetAllocationOptions", () => {
  it("summarizes sources + view + table", () => {
    const s = summarizeAssetAllocationOptions({
      left: { kind: "group", id: "all-liquid" }, right: { kind: "recommended" },
      view: "detailed", includeOutOfEstate: false, showTable: true,
    });
    expect(s).toContain("By class");
    expect(s.toLowerCase()).toContain("table");
  });
});
