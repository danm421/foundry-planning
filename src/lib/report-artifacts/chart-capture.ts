"use client";

import { useEffect } from "react";
import type { ChartImage } from "./types";

export type ChartCaptureRegistration = {
  reportId: string;
  chartId: string;
  dataVersion: string;
};

type Registered = ChartCaptureRegistration & {
  getCanvas: () => HTMLCanvasElement | null;
};

const registry = new Map<string, Registered[]>(); // reportId -> registrations

const cacheKey = (r: ChartCaptureRegistration) =>
  `chart-capture:${r.reportId}:${r.chartId}:${r.dataVersion}`;

function captureCanvas(canvas: HTMLCanvasElement, reg: ChartCaptureRegistration): ChartImage {
  const dataUrl = canvas.toDataURL("image/png");
  return {
    id: reg.chartId,
    dataUrl,
    width: canvas.width,
    height: canvas.height,
    dataVersion: reg.dataVersion,
  };
}

function persist(img: ChartImage, reg: ChartCaptureRegistration): void {
  try {
    sessionStorage.setItem(cacheKey(reg), JSON.stringify(img));
  } catch {
    // sessionStorage may be full or disabled — capture still works in-memory.
  }
}

export function useChartCapture(
  reg: ChartCaptureRegistration,
  getCanvas: () => HTMLCanvasElement | null,
): void {
  useEffect(() => {
    const arr = registry.get(reg.reportId) ?? [];
    arr.push({ ...reg, getCanvas });
    registry.set(reg.reportId, arr);

    // Persist immediately on mount if canvas is ready.
    const canvas = getCanvas();
    if (canvas) {
      persist(captureCanvas(canvas, reg), reg);
    }

    return () => {
      const cur = registry.get(reg.reportId) ?? [];
      const next = cur.filter((r) => r.chartId !== reg.chartId);
      if (next.length === 0) registry.delete(reg.reportId);
      else registry.set(reg.reportId, next);
    };
  }, [reg.reportId, reg.chartId, reg.dataVersion, getCanvas, reg]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function getRegisteredCharts(reportId: string): ChartImage[] {
  const regs = registry.get(reportId) ?? [];
  const out: ChartImage[] = [];
  for (const r of regs) {
    const canvas = r.getCanvas();
    if (!canvas) continue;
    out.push(captureCanvas(canvas, r));
  }
  return out;
}

export function getCachedCharts(reportId: string): ChartImage[] {
  const out: ChartImage[] = [];
  if (typeof sessionStorage === "undefined") return out;
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    if (!k || !k.startsWith(`chart-capture:${reportId}:`)) continue;
    const v = sessionStorage.getItem(k);
    if (!v) continue;
    try { out.push(JSON.parse(v) as ChartImage); } catch { /* skip malformed entries */ }
  }
  return out;
}

// Test-only reset — clears in-memory registry between test cases.
export function _resetChartCapture(): void {
  registry.clear();
}
