import { describe, it, expect } from "vitest";
import { buildDrillChartSpec } from "../build-chart-spec";
import type { TableMarker } from "../../types";

const markers: TableMarker[] = [];

describe("buildDrillChartSpec — y-domain", () => {
  it("keeps a zero floor for all-positive data (regression)", () => {
    const spec = buildDrillChartSpec({
      years: [2030, 2031],
      stacks: [{ seriesId: "a", label: "A", color: "#000", values: [100, 200] }],
      markers,
    });
    expect(spec.yAxis.domain[0]).toBe(0);
    expect(spec.yAxis.domain[1]).toBeGreaterThanOrEqual(200);
  });

  it("drops the floor below zero when a stack is negative", () => {
    const spec = buildDrillChartSpec({
      years: [2030, 2031],
      stacks: [
        { seriesId: "up",   label: "Up",   color: "#0a0", values: [100, 50] },
        { seriesId: "down", label: "Down", color: "#a00", values: [-80, -120] },
      ],
      markers,
    });
    expect(spec.yAxis.domain[0]).toBeLessThan(0);
    expect(spec.yAxis.domain[0]).toBeLessThanOrEqual(-120);
    expect(spec.yAxis.domain[1]).toBeGreaterThanOrEqual(100);
    // A tick at 0 should exist so the renderer can draw a baseline.
    expect(spec.yAxis.ticks.some((t) => Math.abs(t) < 1e-9)).toBe(true);
  });

  it("considers negative line values in the floor", () => {
    const spec = buildDrillChartSpec({
      years: [2030, 2031],
      stacks: [{ seriesId: "a", label: "A", color: "#000", values: [100, 100] }],
      lines: [{ seriesId: "net", label: "Net", color: "#000", strokeWidth: 1.5, values: [20, -90] }],
      markers,
    });
    expect(spec.yAxis.domain[0]).toBeLessThanOrEqual(-90);
  });
});
