import { describe, it, expect } from "vitest";
import { cashFlowOptionsSchema } from "../options-schema";
import { CASH_FLOW_PAGE_OPTIONS_DEFAULT } from "@/lib/presentations/types";

describe("cashFlowOptionsSchema", () => {
  it("accepts the registry default", () => {
    expect(() => cashFlowOptionsSchema.parse(CASH_FLOW_PAGE_OPTIONS_DEFAULT)).not.toThrow();
  });

  it("accepts 'full' range", () => {
    expect(cashFlowOptionsSchema.parse({ range: "full", showCallout: false }).range).toBe("full");
  });

  it("accepts a custom-range options bag", () => {
    const value = {
      range: { startYear: 2030, endYear: 2050 },
      showCallout: true,
      calloutText: "Mid-retirement focus",
    };
    expect(cashFlowOptionsSchema.parse(value)).toEqual(value);
  });

  it("rejects an unknown range string", () => {
    expect(() => cashFlowOptionsSchema.parse({ range: "weird", showCallout: false }))
      .toThrow();
  });

  it("rejects a custom range where endYear < startYear", () => {
    expect(() =>
      cashFlowOptionsSchema.parse({
        range: { startYear: 2040, endYear: 2030 },
        showCallout: false,
      }),
    ).toThrow();
  });

  it("requires showCallout", () => {
    expect(() => cashFlowOptionsSchema.parse({ range: "full" })).toThrow();
  });

  it("coerces a legacy retirement range to full", () => {
    expect(cashFlowOptionsSchema.parse({ range: "retirement", showCallout: true }).range).toBe("full");
  });

  it("coerces a legacy lifetime range to full", () => {
    expect(cashFlowOptionsSchema.parse({ range: "lifetime", showCallout: true }).range).toBe("full");
  });
});
