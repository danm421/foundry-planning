"use client";

import type { ComparisonLayoutV5 } from "@/lib/comparison/layout-schema";
import { canvasToPng } from "@/components/pdf/chart-to-image";

const CHART_KINDS = new Set([
  "portfolio",
  "monte-carlo",
  "longevity",
  "lifetime-tax",
  "liquidity",
  "estate-impact",
  "estate-tax",
  "income-expense",
  "withdrawal-source",
  "ss-income",
  "allocation-drift",
  "tax-bracket-fill",
  "charitable-impact",
  "cash-flow-gap",
  "success-gauge",
  "income-sources",
  "asset-allocation",
]);

const MAX_PNG_BYTES = 2_000_000;

export async function captureCellImages(
  layout: ComparisonLayoutV5,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const g of layout.groups) {
    for (const c of g.cells) {
      if (!c.widget || !CHART_KINDS.has(c.widget.kind)) continue;
      const root = document.querySelector(`[data-render-cell="${c.id}"]`);
      const canvas = root?.querySelector("canvas") as HTMLCanvasElement | null;
      const dataUrl = canvasToPng(canvas);
      if (!dataUrl) continue;
      if (dataUrl.length > MAX_PNG_BYTES) continue;
      out[c.id] = dataUrl;
    }
  }
  return out;
}
