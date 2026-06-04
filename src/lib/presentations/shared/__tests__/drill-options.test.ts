import { describe, it, expect } from "vitest";
import {
  rangeSchema,
  drillOptionsSchema,
  summarizeDrillOptions,
  DRILL_PAGE_OPTIONS_DEFAULT,
} from "../drill-options";

describe("rangeSchema", () => {
  it("accepts 'full'", () => {
    expect(rangeSchema.parse("full")).toBe("full");
  });
  it("accepts a custom {startYear,endYear}", () => {
    expect(rangeSchema.parse({ startYear: 2030, endYear: 2050 })).toEqual({
      startYear: 2030,
      endYear: 2050,
    });
  });
  it("coerces legacy 'retirement' to 'full'", () => {
    expect(rangeSchema.parse("retirement")).toBe("full");
  });
  it("coerces legacy 'lifetime' to 'full'", () => {
    expect(rangeSchema.parse("lifetime")).toBe("full");
  });
  it("rejects endYear < startYear", () => {
    expect(() => rangeSchema.parse({ startYear: 2050, endYear: 2030 })).toThrow();
  });
});

describe("summarizeDrillOptions", () => {
  it("labels full range", () => {
    expect(summarizeDrillOptions({ range: "full", showCallout: false })).toBe("Full range");
  });
  it("labels a custom span with an en-dash", () => {
    expect(
      summarizeDrillOptions({ range: { startYear: 2030, endYear: 2050 }, showCallout: false }),
    ).toBe("2030–2050");
  });
});

describe("drillOptionsSchema", () => {
  it("accepts the registry default", () => {
    expect(() => drillOptionsSchema.parse(DRILL_PAGE_OPTIONS_DEFAULT)).not.toThrow();
  });
  it("accepts a custom-range options bag", () => {
    const value = {
      range: { startYear: 2030, endYear: 2050 },
      showCallout: true,
      calloutText: "Mid-retirement focus",
    };
    expect(drillOptionsSchema.parse(value)).toEqual(value);
  });
  it("rejects an unknown range string", () => {
    expect(() => drillOptionsSchema.parse({ range: "weird", showCallout: false })).toThrow();
  });
  it("requires showCallout", () => {
    expect(() => drillOptionsSchema.parse({ range: "full" })).toThrow();
  });
});

describe("DRILL_PAGE_OPTIONS_DEFAULT", () => {
  it("defaults to full range", () => {
    expect(DRILL_PAGE_OPTIONS_DEFAULT.range).toBe("full");
  });
});
