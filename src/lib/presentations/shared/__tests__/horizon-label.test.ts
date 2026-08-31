import { describe, it, expect } from "vitest";
import { horizonYearsLabel } from "../horizon-label";

describe("horizonYearsLabel", () => {
  it("prints one year when both plans are measured at the same one", () => {
    expect(horizonYearsLabel(2049, 2049)).toBe("2049");
  });

  it("names both years when the plans retire in different years", () => {
    expect(horizonYearsLabel(2054, 2049)).toBe("base 2054 · proposed 2049");
  });

  it("takes the column names the surface actually prints", () => {
    expect(horizonYearsLabel(2054, 2049, "current")).toBe("current 2054 · proposed 2049");
  });
});
