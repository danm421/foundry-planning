import { describe, it, expect } from "vitest";
import {
  barHeat,
  monthsWindow,
  buildHistory,
  computeYearMetrics,
} from "@/lib/portal/category-detail";

describe("barHeat", () => {
  it("returns 'none' when no budget is set", () => {
    expect(barHeat(120, null)).toBe("none");
    expect(barHeat(120, 0)).toBe("none");
  });
  it("returns 'good' comfortably under budget", () => {
    expect(barHeat(100, 500)).toBe("good");
    expect(barHeat(0, 500)).toBe("good");
    expect(barHeat(-30, 500)).toBe("good"); // net refund month
  });
  it("returns 'warn' approaching budget (>=85%, <100%)", () => {
    expect(barHeat(450, 500)).toBe("warn");
    expect(barHeat(499, 500)).toBe("warn");
  });
  it("returns 'crit' at or over budget", () => {
    expect(barHeat(500, 500)).toBe("crit");
    expect(barHeat(620, 500)).toBe("crit");
  });
});

describe("monthsWindow", () => {
  it("returns N consecutive months ending at the current month, chronological", () => {
    const now = new Date("2026-06-15T12:00:00Z");
    expect(monthsWindow(now, 3)).toEqual(["2026-04", "2026-05", "2026-06"]);
  });
  it("crosses year boundaries", () => {
    const now = new Date("2026-02-01T00:00:00Z");
    expect(monthsWindow(now, 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("buildHistory", () => {
  it("fills zero months across the window and applies heat per the budget", () => {
    const now = new Date("2026-03-10T00:00:00Z");
    const raw = { "2026-01": 100, "2026-03": 600 }; // Feb missing
    const bars = buildHistory(raw, monthsWindow(now, 3), 500);
    expect(bars).toEqual([
      { month: "2026-01", amount: 100, heat: "good" },
      { month: "2026-02", amount: 0, heat: "good" },
      { month: "2026-03", amount: 600, heat: "crit" },
    ]);
  });
  it("uses 'none' heat for every bar when no budget", () => {
    const now = new Date("2026-02-01T00:00:00Z");
    const bars = buildHistory({ "2026-02": 300 }, monthsWindow(now, 1), null);
    expect(bars[0]).toEqual({ month: "2026-02", amount: 300, heat: "none" });
  });
});

describe("computeYearMetrics", () => {
  it("totals per year and averages over months that have data", () => {
    const raw = {
      "2025-01": 100,
      "2025-02": 200,
      "2026-01": 300,
      "2026-02": 300,
      "2026-03": 300,
    };
    const metrics = computeYearMetrics(raw);
    expect(metrics).toEqual([
      { year: 2026, total: 900, avgMonthly: 300 }, // 3 active months
      { year: 2025, total: 300, avgMonthly: 150 }, // 2 active months
    ]);
  });
  it("returns newest year first and rounds to cents", () => {
    const metrics = computeYearMetrics({ "2024-05": 33.33, "2024-06": 33.34 });
    expect(metrics).toEqual([{ year: 2024, total: 66.67, avgMonthly: 33.34 }]);
  });
  it("returns an empty array with no data", () => {
    expect(computeYearMetrics({})).toEqual([]);
  });
});
