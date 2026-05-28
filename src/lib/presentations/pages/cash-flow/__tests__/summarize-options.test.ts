import { describe, it, expect } from "vitest";
import { summarizeCashFlowOptions } from "../summarize-options";

describe("summarizeCashFlowOptions", () => {
  it("returns 'Retirement only' for the retirement preset", () => {
    expect(summarizeCashFlowOptions({ range: "retirement", showCallout: true })).toBe("Retirement only");
  });

  it("returns 'Lifetime' for the lifetime preset", () => {
    expect(summarizeCashFlowOptions({ range: "lifetime", showCallout: false })).toBe("Lifetime");
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
