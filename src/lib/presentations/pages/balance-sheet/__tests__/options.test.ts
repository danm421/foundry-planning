import { describe, it, expect } from "vitest";
import { balanceSheetOptionsSchema } from "../options-schema";
import { summarizeBalanceSheetOptions } from "../summarize-options";

describe("balanceSheetOptionsSchema", () => {
  it("defaults includeOutOfEstate to false when omitted", () => {
    const parsed = balanceSheetOptionsSchema.parse({ asOf: "today", year: 2026 });
    expect(parsed.includeOutOfEstate).toBe(false);
  });

  it("preserves an explicit includeOutOfEstate", () => {
    const parsed = balanceSheetOptionsSchema.parse({
      asOf: "eoy",
      year: 2030,
      includeOutOfEstate: true,
    });
    expect(parsed.includeOutOfEstate).toBe(true);
  });
});

describe("summarizeBalanceSheetOptions", () => {
  it("summarizes as-of without the Out of Estate suffix by default", () => {
    expect(summarizeBalanceSheetOptions({ asOf: "today", year: 2026, includeOutOfEstate: false })).toBe(
      "As of today",
    );
    expect(summarizeBalanceSheetOptions({ asOf: "eoy", year: 2030, includeOutOfEstate: false })).toBe(
      "End of 2030",
    );
  });

  it("appends the Out of Estate suffix when enabled", () => {
    expect(summarizeBalanceSheetOptions({ asOf: "today", year: 2026, includeOutOfEstate: true })).toBe(
      "As of today · with Out of Estate",
    );
  });
});
