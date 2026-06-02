import { describe, it, expect } from "vitest";
import {
  taxSummaryOptionsSchema,
  TAX_SUMMARY_OPTIONS_DEFAULT,
} from "../options-schema";

describe("taxSummaryOptionsSchema", () => {
  it("applies default thresholds when fields are omitted", () => {
    const parsed = taxSummaryOptionsSchema.parse({});
    expect(parsed).toEqual({ lowThreshold: 0.22, highThreshold: 0.24 });
  });

  it("exposes the same defaults as the exported constant", () => {
    expect(TAX_SUMMARY_OPTIONS_DEFAULT).toEqual({
      lowThreshold: 0.22,
      highThreshold: 0.24,
    });
  });
});
