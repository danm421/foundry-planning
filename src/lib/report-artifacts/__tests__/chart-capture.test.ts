// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  useChartCapture,
  getRegisteredCharts,
  getCachedCharts,
  _resetChartCapture,
  type ChartCaptureRegistration,
} from "../chart-capture";

function makeFakeCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 800; c.height = 500;
  // jsdom's toDataURL returns 'data:,' by default; stub it.
  c.toDataURL = () => "data:image/png;base64,iVBORw0KGgo=";
  return c;
}

describe("useChartCapture", () => {
  beforeEach(() => {
    sessionStorage.clear();
    _resetChartCapture();
  });

  it("registers a chart on mount", () => {
    const reg: ChartCaptureRegistration = {
      reportId: "investments", chartId: "donut", dataVersion: "v1",
    };
    const canvas = makeFakeCanvas();
    renderHook(() => useChartCapture(reg, () => canvas));

    const charts = getRegisteredCharts("investments");
    expect(charts).toHaveLength(1);
    expect(charts[0].id).toBe("donut");
    expect(charts[0].dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(charts[0].dataVersion).toBe("v1");
  });

  it("unregisters on unmount", () => {
    const canvas = makeFakeCanvas();
    const { unmount } = renderHook(() =>
      useChartCapture({ reportId: "investments", chartId: "donut", dataVersion: "v1" }, () => canvas),
    );
    expect(getRegisteredCharts("investments")).toHaveLength(1);
    unmount();
    expect(getRegisteredCharts("investments")).toHaveLength(0);
  });

  it("persists captured PNGs to sessionStorage keyed by reportId+chartId+dataVersion", () => {
    const canvas = makeFakeCanvas();
    renderHook(() =>
      useChartCapture({ reportId: "investments", chartId: "donut", dataVersion: "v1" }, () => canvas),
    );
    const cached = getCachedCharts("investments");
    expect(cached).toHaveLength(1);
    expect(cached[0].dataVersion).toBe("v1");
  });

  it("returns empty array when no charts cached", () => {
    expect(getCachedCharts("nonexistent")).toEqual([]);
  });

  it("getRegisteredCharts skips charts whose canvas getter returns null", () => {
    renderHook(() =>
      useChartCapture({ reportId: "investments", chartId: "donut", dataVersion: "v1" }, () => null),
    );
    expect(getRegisteredCharts("investments")).toEqual([]);
  });
});
