import { describe, expect, it } from "vitest";
import { selectEarlyYearsDetailYears } from "../early-years-detail";

describe("selectEarlyYearsDetailYears", () => {
  it("keeps five-year checkpoints and required boundary years, sorted and deduplicated", () => {
    expect(
      selectEarlyYearsDetailYears({
        availableYears: Array.from({ length: 38 }, (_, i) => 2026 + i),
        planStartYear: 2026,
        requiredYears: [2063, 2026, 2063],
        maxRows: 12,
      }),
    ).toEqual([2026, 2031, 2036, 2041, 2046, 2051, 2056, 2061, 2063]);
  });

  it("ignores requested years the projection does not contain", () => {
    expect(
      selectEarlyYearsDetailYears({
        availableYears: [2026, 2027, 2028],
        planStartYear: 2026,
        requiredYears: [2025, 2028, 2030],
        maxRows: 5,
      }),
    ).toEqual([2026, 2028]);
  });

  it("thins regular checkpoints before dropping a required year", () => {
    const selected = selectEarlyYearsDetailYears({
      availableYears: Array.from({ length: 70 }, (_, i) => 2026 + i),
      planStartYear: 2026,
      requiredYears: [2026, 2060, 2095],
      maxRows: 8,
    });

    expect(selected).toHaveLength(8);
    expect(selected).toContain(2026);
    expect(selected).toContain(2060);
    expect(selected).toContain(2095);
    expect(selected).toEqual([...selected].sort((a, b) => a - b));
  });
});
