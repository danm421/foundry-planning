import { describe, it, expect } from "vitest";
import { estimateCashFlowPageCount } from "../estimate-page-count";

describe("estimateCashFlowPageCount", () => {
  it("always returns 1 in V1 (Cash Flow is a single PDF page)", () => {
    expect(estimateCashFlowPageCount()).toBe(1);
  });
});
