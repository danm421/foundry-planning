import { describe, it, expect } from "vitest";
import { summarizeCashFlowOptions } from "../summarize-options";

describe("summarizeCashFlowOptions", () => {
  it("returns 'Full range' for the full preset", () => {
    expect(summarizeCashFlowOptions({ range: "full", showCallout: true })).toBe("Full range");
  });

  it("renders a custom year range", () => {
    expect(
      summarizeCashFlowOptions({
        range: { startYear: 2030, endYear: 2050 },
        showCallout: false,
      }),
    ).toBe("2030–2050");
  });
});
