import { describe, it, expect } from "vitest";
import { estimateAssetAllocationPageCount } from "../estimate-page-count";

describe("estimateAssetAllocationPageCount", () => {
  it("returns a fixed page count without reading data (called with undefined at estimate time)", () => {
    expect(estimateAssetAllocationPageCount(undefined)).toBe(1);
  });
});
