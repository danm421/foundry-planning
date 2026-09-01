// Do the three Monte Carlo charts' labels land where they claim to?
//
// Sibling of `pages/cash-flow/chart-axis-geometry.test.tsx`, and it exists for
// the same reason: `charts.test.tsx` next door asserts that a render produced
// SOME bytes, the spec tests assert tick VALUES, and tsc and eslint see JSX. Not
// one of them can see where a glyph landed.
//
// All three charts shipped the cash-flow chart's defects verbatim:
//
//   · every y-axis tick was drawn at `x={-6}` with SVG's default `start` anchor,
//     so it began 6pt left of the plot and ran rightward THROUGH it;
//   · the success chart's bar labels were drawn at the bar centre less a
//     hand-guessed 5pt, and the fan's year ticks at the point itself, so both
//     ran right from there and put their own centre most of a step on — those
//     two look fine and simply name the wrong bar.
//
// So: render the real components from specs the REAL builders produce, and
// measure the actual glyph boxes with `pdftotext -bbox`. The plot origin and the
// x positions come from the same `spec.margin.left` and `chart-geom` scales the
// components lay out with, so guard and chart cannot drift. The page offset
// cancels — a label and the thing it names move together — so each chart is
// measured on a bare, unpadded sheet.
//
// Every label must be FOUND, and each match must be UNIQUE, so this cannot pass
// vacuously. ⚠️ Uniqueness is why the success fixture uses ages 65+: its y-axis
// prints 0/25/50/75/100 and an age of 75 would match two words.
//
// Measured at `scale` 1. The thumbnails are strictly slacker — the margins are
// unscaled points while the type is `7 * scale`, so a half-size chart keeps the
// full gutter and prints half-width labels into it.
//
// Needs poppler on PATH (`brew install poppler`), same as its cash-flow
// sibling. It says so rather than skipping: a measurement that quietly opts out
// is worse than one that is absent, because the suite goes on reporting green.
import { describe, it, expect } from "vitest";
import { renderToBuffer, Document, Page } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { wordBoxes, BBOX_EPS as EPS, type Word } from "@/components/presentations/shared/test-utils/pdf-bbox";
import { compactCurrency } from "@/lib/presentations/format";
import {
  buildFanChartSpec,
  buildHistogramChartSpec,
  buildSuccessChartSpec,
} from "@/lib/presentations/charts/monte-carlo-specs";
import { fanXScale, successBandScale, innerWidth } from "../chart-geom";
import { FanChartPdf } from "../fan-pdf";
import { HistogramPdf } from "../histogram-pdf";
import { SuccessPdf } from "../success-pdf";

type Spec = { width: number; height: number; margin: { left: number; right: number } };

/** Render one chart alone on an unpadded sheet, so page coordinates ARE the
 *  chart's own SVG coordinates and the plot origin is `spec.margin.left`. */
async function renderWords(spec: Spec, chart: React.ReactElement): Promise<Word[]> {
  ensureFontsRegistered();
  const pdf = await renderToBuffer(
    <Document>
      <Page size={[spec.width, spec.height]} style={{ padding: 0 }}>
        {chart}
      </Page>
    </Document>,
  );
  return wordBoxes(pdf, 1);
}

/** The box of a label the chart drew. Required to match exactly one word on the
 *  sheet — a miss means the guard is measuring nothing, a second hit means it is
 *  measuring some other text and saying nothing about this one.
 *
 *  Zero hits also catches a label pushed clean off the sheet, because here the
 *  sheet IS the SVG viewport and a word past it is dropped from the render
 *  outright; one only PARTLY off is still listed, with a negative `xMin`, which
 *  is what `assertGutterHolds` reads. ⚠️ Neither generalises to a real page: the
 *  chart is narrower than the sheet there, and a run clipped at the viewport
 *  keeps its full extent in the text layer — the ink is gone but the words are
 *  not. Only a raster sees that one. */
function box(words: Word[], label: string): Word {
  const hits = words.filter((w) => w.text === label);
  expect(
    hits.length,
    `"${label}" matched ${hits.length} words on the sheet, not 1`
      + (hits.length === 0 ? " — either it was never drawn, or it ran off the sheet and was dropped" : ""),
  ).toBe(1);
  return hits[0];
}

/** Every y-axis tick label sits in the left gutter: right-anchored, so it ends
 *  just short of the plot and grows leftward into the margin it was given. */
function assertGutterHolds(spec: Spec, words: Word[], labels: string[]) {
  const origin = spec.margin.left;
  const boxes = labels.map((text) => ({ text, b: box(words, text) }));

  const intruding = boxes
    .filter((f) => f.b.xMax > origin + EPS)
    .map((f) => `y-axis tick "${f.text}" runs to ${f.b.xMax.toFixed(1)}pt, ${(f.b.xMax - origin).toFixed(1)}pt into the plot (origin ${origin}pt)`);
  expect(intruding).toEqual([]);

  // The other wall: right-anchored labels grow leftward, so one wider than the
  // gutter runs off the canvas instead of overprinting. This is the assertion
  // the left margin is now sized by.
  const clipped = boxes
    .filter((f) => f.b.xMin < -EPS)
    .map((f) => `y-axis tick "${f.text}" starts at ${f.b.xMin.toFixed(1)}pt, off the left edge of a ${spec.width}pt canvas (gutter ${origin}pt)`);
  expect(clipped).toEqual([]);
}

/** How far a label's centre may sit from the thing it names. The defects this
 *  catches are half a label wide — measured on this family at 8.4pt on the fan's
 *  years, half a step, and 3.4pt on the success chart's year labels — while a
 *  correctly anchored label lands within hundredths of a point. So a point is
 *  loose enough for glyph side bearings and still an order of magnitude tighter
 *  than the thing it is looking for.
 *
 *  The cash-flow guard declares its own, at the same value: the number is shared
 *  but the evidence for it is not, and the evidence is what makes it reviewable.
 *  Its assertions stay separate for a sharper reason — that guard tolerates a
 *  label it cannot find and reports the misses as a batch, where this one
 *  requires every match to be unique up front. Merging them would have to pick
 *  one of those policies. */
const CENTRE_EPS = 1;

function assertCentred(
  spec: Spec,
  labels: Array<{ what: string; centre: number; b: Word }>,
  step: number,
) {
  const adrift = labels
    .map((l) => ({ ...l, off: (l.b.xMin + l.b.xMax) / 2 - l.centre }))
    .filter((l) => Math.abs(l.off) > CENTRE_EPS)
    .map((l) => `${l.what} is centred ${l.off.toFixed(1)}pt (${(l.off / step).toFixed(2)} steps) off the point it names`);
  expect(adrift).toEqual([]);

  // A centred label grows BOTH ways, so one on an end bar can reach past the
  // canvas — where, on this bare sheet, it stops being drawn altogether.
  const offCanvas = labels
    .filter((l) => l.b.xMin < -EPS || l.b.xMax > spec.width + EPS)
    .map((l) => `${l.what} spans ${l.b.xMin.toFixed(1)}–${l.b.xMax.toFixed(1)}pt on a canvas ${spec.width}pt wide`);
  expect(offCanvas).toEqual([]);
}

// ── Fixtures ────────────────────────────────────────────────────────────────
// Shaped like a real run: a 30-year projection of a multi-million-dollar
// portfolio, so the fan's y-axis reaches the widest label `compactCurrency`
// prints on this page ("$X.XM").
const byYear = Array.from({ length: 30 }, (_, i) => ({
  year: 2026 + i,
  age: { client: 60 + i },
  balance: {
    p5: 400_000 + i * 10_000,
    p20: 900_000 + i * 40_000,
    p50: 1_400_000 + i * 70_000,
    p80: 1_900_000 + i * 110_000,
    p95: 2_400_000 + i * 160_000,
    min: 0,
    max: 6_000_000,
  },
  cagrFromStart: null,
}));

const histogramSeries = {
  bins: Array.from({ length: 12 }, (_, i) => ({
    min: i * 500_000,
    max: (i + 1) * 500_000,
    count: [12, 48, 130, 244, 310, 268, 180, 96, 52, 24, 10, 4][i],
  })),
  p5: 300_000, p25: 1_400_000, p50: 2_300_000, p75: 3_300_000, p95: 4_800_000,
  belowDomainCount: 0, aboveDomainCount: 0,
  sd: {
    mean: 2_400_000, stdDev: 1_100_000, minus2: 200_000, minus1: 1_300_000,
    plus1: 3_500_000, plus2: 4_600_000,
    countWithin1: 700, countWithin2: 950, countBelowMinus2: 10, countAbovePlus2: 40,
  },
};

describe("Monte Carlo fan chart geometry", () => {
  it("keeps every y-axis tick in the gutter and centres each year on its point", async () => {
    const spec = buildFanChartSpec({
      byYear,
      deterministic: byYear.map((r) => r.balance.p50),
      // Parked mid-domain, where `buildMarkers` puts the real ones.
      // The real one, verbatim from `buildMonteCarloData`: `Retire {age}`.
      markers: [{ atYear: 2038, label: "Retire 65" }],
    });
    expect(
      spec.yTicks.map((t) => compactCurrency(t)).some((l) => l.endsWith("M")),
      "fixture did not reach a millions label on the y-axis",
    ).toBe(true);

    const words = await renderWords(spec, <FanChartPdf spec={spec} />);
    assertGutterHolds(spec, words, spec.yTicks.map((t) => compactCurrency(t)));

    // The marker is drawn beside its rule (`x={cx + 2}`, left-anchored) rather
    // than centred on it, so it is not part of the centring check below — but it
    // is the widest thing this chart prints above the plot, and the cash-flow
    // chart's equivalent was running clean off the sheet. So: does it fit?
    const marker = spec.markers[0];
    const run = marker.label.split(" ").map((w) => box(words, w));
    const runMax = Math.max(...run.map((b) => b.xMax));
    expect(
      runMax <= spec.width - EPS,
      `marker "${marker.label}" reaches ${runMax.toFixed(1)}pt on a ${spec.width}pt canvas`,
    ).toBe(true);

    const x = fanXScale(spec);
    expect(spec.xTicks.length, "fixture produced no x-axis ticks to measure").toBeGreaterThan(3);
    assertCentred(
      spec,
      spec.xTicks.map((t) => ({
        what: `x-axis tick "${t}"`,
        centre: spec.margin.left + (x(t) ?? 0),
        b: box(words, String(t)),
      })),
      x.step(),
    );
  }, 30_000);

  it("holds the gutter at the widest label compactCurrency can print", async () => {
    // The gutter is sized for an 8-character label, and a 30-year projection of
    // a large portfolio is what gets there: `compactCurrency` has no billions
    // branch, so $2B prints as "$2000.0M". Without this case the fixture above
    // tops out at "$6.0M" and the gutter could be cut by a third with every
    // test still green — while a real deck of this size clipped.
    const rich = byYear.map((r, i) => ({
      ...r,
      balance: { ...r.balance, p80: 400_000_000 + i * 60_000_000 },
    }));
    const spec = buildFanChartSpec({ byYear: rich, deterministic: null, markers: [] });
    const labels = spec.yTicks.map((t) => compactCurrency(t));
    expect(
      Math.max(...labels.map((l) => l.length)),
      `fixture's widest label was ${labels[labels.length - 1]}, not the 8 characters the gutter is sized for`,
    ).toBe(8);
    assertGutterHolds(spec, await renderWords(spec, <FanChartPdf spec={spec} />), labels);
  }, 30_000);
});

describe("Monte Carlo histogram geometry", () => {
  it("keeps every y-axis tick in the gutter and pins each end label to its plot edge", async () => {
    const spec = buildHistogramChartSpec(histogramSeries);
    const words = await renderWords(spec, <HistogramPdf spec={spec} />);
    assertGutterHolds(spec, words, spec.yTicks.map((t) => String(t)));

    // The x axis prints only the domain's two ends, so they are pinned to the
    // plot's edges rather than centred: the low label starts at the left edge,
    // the high label ends at the right one.
    const right = spec.margin.left + innerWidth(spec);
    const lo = box(words, compactCurrency(spec.xDomain[0]));
    const hi = box(words, compactCurrency(spec.xDomain[1]));
    // Within EPS, not exact: these are glyph boxes, and a font or poppler bump
    // that shifts a side bearing by a tenth of a point must not redden an
    // anchoring test for a reason that has nothing to do with anchoring.
    const misplaced = [
      ...(Math.abs(lo.xMin - spec.margin.left) > EPS
        ? [`the low label starts at ${lo.xMin.toFixed(1)}pt, not the plot's left edge (${spec.margin.left}pt)`] : []),
      ...(Math.abs(hi.xMax - right) > EPS
        ? [`the high label ends at ${hi.xMax.toFixed(1)}pt, not the plot's right edge (${right.toFixed(1)}pt)`] : []),
    ];
    expect(misplaced).toEqual([]);
  }, 30_000);
});

describe("Monte Carlo success chart geometry", () => {
  // Both label widths this chart can print. `buildSuccessChartSpec` labels a bar
  // with its age, and falls back to the YEAR when the age is unavailable — twice
  // as wide, and the case the old hand-nudge actually broke: `- 5` was fitted to
  // half a two-digit age, so a four-digit year landed 3.4pt on. Reverting the
  // nudge leaves the AGE case green and reddens only this one, which is the
  // point: a hand-fit is right for exactly one label width.
  const cases = [
    // 65+ so no age can collide with the 0/25/50/75/100 the y axis prints.
    { what: "ages", ages: (i: number): number | null => 65 + i },
    { what: "years (no ages)", ages: (): number | null => null },
  ];

  for (const { what, ages } of cases) {
    it(`keeps every y-axis tick in the gutter and centres each ${what} label on its bar`, async () => {
      const n = 26;
      const spec = buildSuccessChartSpec({
        successRates: Array.from({ length: n }, (_, i) => 0.98 - i * 0.02),
        years: Array.from({ length: n }, (_, i) => 2026 + i),
        ages: Array.from({ length: n }, (_, i) => ages(i)),
      });
      const words = await renderWords(spec, <SuccessPdf spec={spec} />);
      assertGutterHolds(spec, words, ["0", "25", "50", "75", "100"]);

      const bars = successBandScale(spec);
      const drawn = spec.bars
        .map((b, i) => ({ b, i }))
        .filter(({ i }) => i % spec.labelEvery === 0);
      expect(drawn.length, "fixture produced no bar labels to measure").toBeGreaterThan(3);
      assertCentred(
        spec,
        drawn.map(({ b, i }) => ({
          what: `bar ${i} label "${b.label}"`,
          centre: spec.margin.left + (bars(i) ?? 0) + bars.bandwidth() / 2,
          b: box(words, b.label),
        })),
        bars.step(),
      );
    }, 30_000);
  }
});
