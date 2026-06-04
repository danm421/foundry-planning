import { describe, it, expect } from "vitest";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { AssetAllocationPagePdf } from "../page-pdf";
import type { AssetAllocationData } from "@/lib/presentations/pages/asset-allocation/view-model";
import type { DonutSpec } from "@/lib/presentations/charts/types";
import { DEFAULT_ACCENT } from "@/lib/presentations/theme";

ensureFontsRegistered();

const PALETTE = [
  "#b23b2e", "#3f6fb0", "#3f8f5f", "#111111", "#b23b2e", "#9b59b6",
  "#caa23a", "#e08a2b", "#7f8c9b", "#c0567a", "#9aa0a6",
];

const CLASSES = [
  { id: "us-large", name: "US Large Cap", l: 0.371, r: 0.30 },
  { id: "us-mid", name: "US Mid Cap", l: 0.123, r: 0.10 },
  { id: "us-small", name: "US Small Cap", l: 0.059, r: 0.0 },
  { id: "global-ex", name: "Global ex-US Stock Market", l: 0.103, r: 0.10 },
  { id: "em", name: "Emerging Markets", l: 0.057, r: 0.05 },
  { id: "st-treas", name: "Short Term Treasury", l: 0.036, r: 0.05 },
  { id: "10yr", name: "10-year Treasury", l: 0.143, r: 0.25 },
  { id: "tips", name: "TIPS", l: 0.024, r: 0.05 },
  { id: "reit", name: "REIT", l: 0.047, r: 0.05 },
  { id: "gold", name: "Gold", l: 0.036, r: 0.05 },
  { id: "inflation", name: "Inflation", l: 0.0, r: 0.0 },
];

function donut(side: "l" | "r"): DonutSpec {
  const segs = CLASSES.filter((c) => c[side] > 0).map((c, i) => ({
    key: c.id,
    label: c.name,
    value: c[side],
    color: PALETTE[i % PALETTE.length],
    fraction: c[side],
  }));
  return {
    kind: "donut",
    size: 150,
    rings: [{ segments: segs }],
    legend: CLASSES.filter((c) => c[side] > 0).map((c, i) => ({
      label: c.name,
      color: PALETTE[i % PALETTE.length],
      pct: c[side],
    })),
  };
}

const data: AssetAllocationData = {
  subtitle: "All Liquid Assets vs Balanced (60/40)",
  leftName: "All Liquid Assets",
  rightName: "Balanced (60/40)",
  leftDonut: donut("l"),
  rightDonut: donut("r"),
  tableRows: CLASSES.map((c) => ({ id: c.id, name: c.name, leftPct: c.l, rightPct: c.r })),
  diffRows: CLASSES.map((c) => ({ id: c.id, name: c.name, diffPct: c.l - c.r }))
    .sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct)),
  disclosure: "Investable assets only.",
};

const framing = {
  firmName: "Foundry Financial",
  clientName: "Cooper Sample",
  reportDate: "June 1, 2026",
  pageIndex: 1,
  totalPages: 1,
  accent: DEFAULT_ACCENT,
};

function countPages(buf: Buffer): number {
  const s = buf.toString("latin1");
  return (s.match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
}

describe("AssetAllocationPagePdf render smoke", () => {
  // Table + Difference render side-by-side; previously they stacked and
  // overflowed onto a blank second page.
  it("comparison (table + diff) fits on one page", async () => {
    const buf = await renderToBuffer(
      <Document>{AssetAllocationPagePdf({ data, ...framing })}</Document>,
    );
    expect(countPages(buf)).toBe(1);
  });
});
