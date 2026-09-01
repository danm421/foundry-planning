// Measure a rendered PDF's real glyph geometry.
//
// The geometry guards in this subsystem exist because layout defects — text
// running past its card, an axis label printed across the bars — are invisible
// to tsc, to eslint, and to a render smoke that asserts a byte length. The only
// instrument that sees them is the rendered sheet itself, so these guards render
// the real component and read the actual glyph boxes back out of the PDF.
//
// Requires poppler on PATH (`brew install poppler`). It throws saying so rather
// than skipping: a measurement that quietly opts out is worse than one that is
// absent, because the suite goes on reporting green.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Word {
  text: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

/** Glyph boxes sit a fraction of a point outside the box they were laid out in;
 *  the overflow these guards exist to catch is tens of points. */
export const BBOX_EPS = 0.5;

/** Every glyph run in `pdf`, with the box it occupies, in PDF points from the
 *  top-left of the page. Pass `page` to measure one sheet of a longer render. */
export function wordBoxes(pdf: Buffer, page?: number): Word[] {
  const dir = mkdtempSync(join(tmpdir(), "pdf-bbox-"));
  const file = join(dir, "sheet.pdf");
  try {
    writeFileSync(file, pdf);
    const range = page == null ? [] : ["-f", String(page), "-l", String(page)];
    let xhtml: string;
    try {
      xhtml = execFileSync("pdftotext", ["-bbox", ...range, file, "-"], { encoding: "utf8" });
    } catch (cause) {
      throw new Error(
        "this measurement needs `pdftotext` (poppler) on PATH — `brew install poppler`",
        { cause },
      );
    }
    const out: Word[] = [];
    for (const line of xhtml.split("\n")) {
      const w = /<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)">(.*)<\/word>/.exec(line);
      if (w) out.push({ text: w[5], xMin: +w[1], yMin: +w[2], xMax: +w[3], yMax: +w[4] });
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
