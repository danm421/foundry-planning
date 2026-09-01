// The mechanics every chart-axis geometry guard needs: render one chart alone,
// find the label it drew, and say where the glyphs actually landed.
//
// These guards exist because the defect they hunt — an axis label printed across
// the plot, or centred half a step off the bar it names — is invisible to tsc,
// to eslint, and to a render smoke that asserts a byte length. The only
// instrument that sees it is the rendered sheet, so they render the real
// component and read the real glyph boxes back out of the PDF.
//
// ⚠️ These carry the STRICT vacuity policy: every label must be found, and each
// match must be unique. `pages/cash-flow/chart-axis-geometry.test.tsx` keeps its
// own, deliberately lenient variant — it tolerates a label it cannot find and
// reports the misses as a batch. That difference is a policy choice, not
// duplication, which is why this module does not try to serve both.
//
// Needs poppler on PATH (`brew install poppler`), via `pdf-bbox`.
import { expect } from "vitest";
import { renderToBuffer, Document, Page } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { wordBoxes, BBOX_EPS as EPS, type Word } from "./pdf-bbox";

/** Just enough of a chart's layout to place its plot on the sheet. */
export interface ChartBox {
  width: number;
  height: number;
  margin: { left: number; right: number };
}

/** Render one chart alone on an unpadded sheet, so page coordinates ARE the
 *  chart's own SVG coordinates and the plot origin is `margin.left`. The page
 *  offset a real deck adds cancels anyway — a label and the thing it names move
 *  together — so measuring bare loses nothing and removes a variable. */
export async function renderChartWords(box: ChartBox, chart: React.ReactElement): Promise<Word[]> {
  ensureFontsRegistered();
  const pdf = await renderToBuffer(
    <Document>
      <Page size={[box.width, box.height]} style={{ padding: 0 }}>
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
export function labelBox(words: Word[], label: string): Word {
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
export function assertGutterHolds(box: ChartBox, words: Word[], labels: string[]) {
  const origin = box.margin.left;
  const boxes = labels.map((text) => ({ text, b: labelBox(words, text) }));

  const intruding = boxes
    .filter((f) => f.b.xMax > origin + EPS)
    .map((f) => `y-axis tick "${f.text}" runs to ${f.b.xMax.toFixed(1)}pt, ${(f.b.xMax - origin).toFixed(1)}pt into the plot (origin ${origin}pt)`);
  expect(intruding).toEqual([]);

  // The other wall: right-anchored labels grow leftward, so one wider than the
  // gutter runs off the canvas instead of overprinting.
  const clipped = boxes
    .filter((f) => f.b.xMin < -EPS)
    .map((f) => `y-axis tick "${f.text}" starts at ${f.b.xMin.toFixed(1)}pt, off the left edge of a ${box.width}pt canvas (gutter ${origin}pt)`);
  expect(clipped).toEqual([]);
}

/** How far a label's centre may sit from the thing it names. The defects this
 *  catches are half a label wide — measured across this subsystem at 3.4pt to
 *  8.4pt, up to half a step — while a correctly anchored label lands within
 *  hundredths of a point. So a point is loose enough for glyph side bearings and
 *  still an order of magnitude tighter than the thing it is looking for. Each
 *  guard records the magnitude IT measured, because that is the evidence; this
 *  is only the threshold they agree on. */
export const CENTRE_EPS = 1;

export interface CentredLabel {
  what: string;
  centre: number;
  b: Word;
}

export function assertCentred(box: ChartBox, labels: CentredLabel[], step: number) {
  const adrift = labels
    .map((l) => ({ ...l, off: (l.b.xMin + l.b.xMax) / 2 - l.centre }))
    .filter((l) => Math.abs(l.off) > CENTRE_EPS)
    .map((l) => `${l.what} is centred ${l.off.toFixed(1)}pt (${(l.off / step).toFixed(2)} steps) off the point it names`);
  expect(adrift).toEqual([]);

  // A centred label grows BOTH ways, so one on an end bar can reach past the
  // canvas — where, on this bare sheet, it stops being drawn altogether.
  const offCanvas = labels
    .filter((l) => l.b.xMin < -EPS || l.b.xMax > box.width + EPS)
    .map((l) => `${l.what} spans ${l.b.xMin.toFixed(1)}–${l.b.xMax.toFixed(1)}pt on a canvas ${box.width}pt wide`);
  expect(offCanvas).toEqual([]);
}

export { BBOX_EPS, type Word } from "./pdf-bbox";
