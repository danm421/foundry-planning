// src/components/presentations/pages/cash-flow/__tests__/chart-marker-labels.test.tsx
//
// Timeline marker labels. A couple's chart carries four: two retirements a year
// apart and two end-of-life markers a year apart. Centred on their own bars
// they are ~80pt of text on centres ~14pt apart, so a real client deck printed
// "Matt NewnhaCarrie — Retirement" at the left of the plot and
// "Matt NewnhCarrie — End of Lif" clipped off the right edge.
//
// Neither failure announces itself — overprinted text still renders, and an
// @react-pdf `Svg` child past the viewport is simply not drawn — so the render
// case below reads the ink back off the PDF rather than trusting the geometry
// helper. The pure cases pin the rules; the render case pins the wiring.
import { describe, it, expect } from "vitest";
import { Document, Page, View, renderToBuffer } from "@react-pdf/renderer";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CashflowChartPdf } from "../chart-pdf";
import { bandScale, markerLabelLayout, markerLabelWidth } from "../chart-geom";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import type { ChartSpec } from "@/lib/presentations/charts/types";

ensureFontsRegistered();

const PAGE_PAD = 43;
/** The four markers a married couple's chart carries, at the years the audited
 *  deck put them: retirements in 2026/2027, end of life in 2057/2058. */
const MARKERS = [
  { atX: 2026, label: "Matt Newnham — Retirement", color: "#0b6", iconKind: "retirement" as const },
  { atX: 2027, label: "Carrie Culver — Retirement", color: "#0b6", iconKind: "retirement" as const },
  { atX: 2057, label: "Matt Newnham — End of Life", color: "#777", iconKind: "endOfLife" as const },
  { atX: 2058, label: "Carrie Culver — End of Life", color: "#777", iconKind: "endOfLife" as const },
];

/** The real cash-flow chart geometry (see `buildCashFlowChartSpec`). */
function spec(markers = MARKERS): ChartSpec {
  const years = Array.from({ length: 33 }, (_, i) => 2026 + i);
  return {
    kind: "stackedBarWithLine", width: 540, height: 260,
    margin: { top: 24, right: 16, bottom: 56, left: 64 },
    xAxis: { domain: years, ticks: [2030, 2040, 2050], labelFormat: (v: number) => String(v) },
    yAxis: { domain: [0, 100], ticks: [0, 50, 100], gridlineColor: "#eee", labelFormat: (v: number) => String(v) },
    stacks: [{ seriesId: "a", label: "A", color: "#0b6", values: years.map(() => 40) }],
    lines: [], markers,
    legend: { position: "bottom", items: [{ kind: "swatch", label: "A", color: "#0b6" }] },
  } as unknown as ChartSpec;
}

function placements(s: ChartSpec) {
  const x = bandScale(s);
  const bw = x.bandwidth();
  return markerLabelLayout(s.markers, s.markers.map((m) => (x(m.atX) ?? 0) + bw / 2), s);
}

describe("marker label geometry", () => {
  it("keeps every label inside the canvas react-pdf will draw", () => {
    const s = spec();
    // In the plot group's own coordinates the canvas runs [-margin.left, width - margin.left].
    for (const [i, p] of placements(s).entries()) {
      expect(p.x - p.halfWidth, `"${s.markers[i].label}" left edge`).toBeGreaterThanOrEqual(-s.margin.left);
      expect(p.x + p.halfWidth, `"${s.markers[i].label}" right edge`).toBeLessThanOrEqual(s.width - s.margin.left);
    }
  });

  it("never lets two labels overlap", () => {
    const p = placements(spec());
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const sameRow = p[i].y === p[j].y;
        const overlaps = p[i].x - p[i].halfWidth < p[j].x + p[j].halfWidth
          && p[j].x - p[j].halfWidth < p[i].x + p[i].halfWidth;
        expect(sameRow && overlaps, `markers ${i} and ${j} share a row and overlap`).toBe(false);
      }
    }
  });

  it("stacks within the room the top margin has", () => {
    for (const p of placements(spec())) {
      // y is negative (above the plot); the label's ink must stay inside margin.top.
      expect(Math.abs(p.y)).toBeLessThanOrEqual(24);
    }
  });

  it("leaves a lone, well-clear label centred on its bar", () => {
    // The rules must not disturb the common case: one marker, room on both
    // sides. A label that moved here would be annotating the wrong year.
    const s = spec([{ ...MARKERS[2], atX: 2040 }] as typeof MARKERS);
    const scale = bandScale(s);
    const p = placements(s)[0];
    expect(p.x).toBeCloseTo((scale(2040) ?? 0) + scale.bandwidth() / 2, 6);
    expect(p.y).toBe(-4);
  });
});

describe("marker labels as rendered", () => {
  it("prints all four labels, none clipped and none overprinted", async () => {
    const s = spec();
    const buf = await renderToBuffer(
      <Document>
        <Page size="LETTER" style={{ padding: PAGE_PAD }}>
          <View>{CashflowChartPdf({ spec: s })}</View>
        </Page>
      </Document>,
    );
    const dir = mkdtempSync(join(tmpdir(), "mk-"));
    let xml: string;
    try {
      const pdf = join(dir, "d.pdf");
      writeFileSync(pdf, buf);
      execFileSync("pdftotext", ["-bbox", pdf, join(dir, "d.xml")]);
      xml = readFileSync(join(dir, "d.xml"), "utf8");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    const words = [...xml.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)"[^>]*>([^<]*)<\/word>/g)]
      .map((m) => ({ x0: +m[1], y: +m[2], x1: +m[3], t: m[4] }));

    // The marker labels are the only ink made of these words.
    const tokens = new Set(MARKERS.flatMap((m) => m.label.split(/\s+/)));
    const hits = words.filter((w) => tokens.has(w.t));
    expect(hits.length, "no marker label ink found").toBeGreaterThan(0);

    // Label ink grouped by baseline: each group is one row of labels.
    const byBaseline = new Map<string, typeof hits>();
    for (const w of hits) {
      const k = w.y.toFixed(1);
      byBaseline.set(k, [...(byBaseline.get(k) ?? []), w]);
    }

    // Nothing may reach past the canvas the chart declares — text drawn beyond
    // it is silently dropped, which is how the deck lost "…End of Lif".
    const canvasRight = PAGE_PAD + s.width;
    for (const w of hits) {
      expect(w.x1, `"${w.t}" runs past the chart canvas`).toBeLessThanOrEqual(canvasRight);
      expect(w.x0, `"${w.t}" runs off the page`).toBeGreaterThanOrEqual(0);
    }

    // The clamp is only as good as the width it clamps: if the estimate ever
    // under-stated a real label, the label would go back off the canvas. Pin
    // that against the ink actually laid down. Two labels can share a baseline,
    // so measure the window of words that IS this label, not the whole row.
    for (const m of MARKERS) {
      const want = m.label.split(/\s+/);
      const box = [...byBaseline.values()]
        .map((ws) => [...ws].sort((a, b) => a.x0 - b.x0))
        .flatMap((row) =>
          row
            .map((_, k) => row.slice(k, k + want.length))
            .filter((win) => win.length === want.length && win.every((w, k) => w.t === want[k])),
        )[0];
      expect(box, `"${m.label}" is not laid out as one run of words`).toBeDefined();
      const inked = box[box.length - 1].x1 - box[0].x0;
      expect(
        markerLabelWidth(m.label),
        `estimated width for "${m.label}" under-states its ${inked.toFixed(2)}pt of ink`,
      ).toBeGreaterThanOrEqual(inked);
    }

    const runs = [...byBaseline.values()].map((ws) =>
      ws.sort((a, b) => a.x0 - b.x0).map((w) => w.t).join(" "),
    );
    for (const m of MARKERS) {
      expect(
        runs.some((r) => r.includes(m.label)),
        `"${m.label}" is not readable on any one baseline — got ${JSON.stringify(runs)}`,
      ).toBe(true);
    }
  }, 60_000);
});
