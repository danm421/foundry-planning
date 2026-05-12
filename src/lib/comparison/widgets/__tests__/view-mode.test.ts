import { describe, it, expect } from "vitest";
import { ViewModeSchema, defaultViewMode, getViewMode } from "../view-mode";

describe("view-mode", () => {
  it("defaultViewMode is { viewMode: 'chart' }", () => {
    expect(defaultViewMode).toEqual({ viewMode: "chart" });
  });

  it("ViewModeSchema accepts the three modes", () => {
    expect(ViewModeSchema.parse({ viewMode: "chart" })).toEqual({ viewMode: "chart" });
    expect(ViewModeSchema.parse({ viewMode: "chart+table" })).toEqual({ viewMode: "chart+table" });
    expect(ViewModeSchema.parse({ viewMode: "table" })).toEqual({ viewMode: "table" });
  });

  it("getViewMode returns 'chart' for undefined/invalid configs", () => {
    expect(getViewMode(undefined)).toBe("chart");
    expect(getViewMode(null)).toBe("chart");
    expect(getViewMode({})).toBe("chart");
    expect(getViewMode({ viewMode: "bogus" })).toBe("chart");
  });

  it("getViewMode returns the configured value for valid configs", () => {
    expect(getViewMode({ viewMode: "chart+table" })).toBe("chart+table");
    expect(getViewMode({ viewMode: "table" })).toBe("table");
  });
});
