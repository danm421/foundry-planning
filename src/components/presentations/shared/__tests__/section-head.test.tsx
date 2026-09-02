// A scenario name is free text an advisor types, and it lands in every data
// page's head as `Title | Scenario · Retire age N in YYYY · through YYYY`.
// "Stay in CA - Roth Convert 32% bracket" printed straight THROUGH "Retirement
// Summary" and then 49pt off the right edge of the paper — react-pdf shrank the
// title's box to make room and, since it does not clip text to a box, the
// title's words stayed where they were while the subtitle started inside them.
//
// Measured from the rendered PDF, because nothing else can see it: the
// component type-checks, and a snapshot of the element tree is identical either
// way. `pdftotext -bbox` gives the ink's real position on the paper.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { PageFrame, PAGE_WIDTH_PORTRAIT, PAGE_PAD_X } from "../page-frame";
import { SectionHead } from "../section-head";
import { ensureFontsRegistered } from "../fonts";
import { DEFAULT_ACCENT } from "@/lib/presentations/theme";

const RIGHT_EDGE = PAGE_WIDTH_PORTRAIT - PAGE_PAD_X;

interface Word { x: number; x2: number; y: number; text: string }

async function wordsOf(title: string, subtitle?: string): Promise<Word[]> {
  ensureFontsRegistered();
  const buf = await renderToBuffer(
    <Document>
      <PageFrame firmName="Foundry Financial" clientName="Matt & Carrie" reportDate="September 2, 2026" pageIndex={1} totalPages={1}>
        <SectionHead title={title} subtitle={subtitle} accent={DEFAULT_ACCENT} />
      </PageFrame>
    </Document>,
  );
  const dir = mkdtempSync(join(tmpdir(), "section-head-"));
  const file = join(dir, "head.pdf");
  writeFileSync(file, buf);
  let bbox: string;
  try {
    bbox = execFileSync("pdftotext", [file, "-bbox", "-"], { encoding: "utf8" });
  } catch {
    throw new Error("this measurement needs `pdftotext` (poppler) on PATH — `brew install poppler`");
  }
  return [...bbox.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="[\d.]+">([^<]*)<\/word>/g)]
    .map((m) => ({ x: Number(m[1]), y: Number(m[2]), x2: Number(m[3]), text: m[4] }))
    // the head is the only thing on the page; drop the frame's own rails
    .filter((w) => w.y > 70 && w.y < 110);
}

const LONG = "Stay in CA - Roth Convert 32% bracket · Retire age 64 in 2026 · through 2058";

describe("SectionHead", () => {
  it("keeps a long subtitle inside the paper", async () => {
    const words = await wordsOf("Retirement Summary", LONG);
    const overflow = words.filter((w) => w.x2 > RIGHT_EDGE);
    expect(overflow.map((w) => `${w.text}@${w.x2.toFixed(1)}`)).toEqual([]);
  });

  it("does not let a long subtitle print over the title", async () => {
    const words = await wordsOf("Retirement Summary", LONG);
    const title = words.filter((w) => w.text === "Retirement" || w.text === "Summary");
    const subtitleStart = words.find((w) => w.text === "|");
    expect(title).toHaveLength(2);
    expect(subtitleStart).toBeDefined();
    expect(subtitleStart!.x).toBeGreaterThan(Math.max(...title.map((w) => w.x2)));
  });

  it("truncates rather than wrapping, so the head keeps its one-line height", async () => {
    const words = await wordsOf("Retirement Summary", LONG);
    // One baseline for the title, one for the subtitle — a wrapped subtitle
    // adds a third and, under `alignItems: baseline`, the extra line lands
    // ABOVE the title and busts the head's ~42pt budget.
    const baselines = new Set(words.map((w) => w.y.toFixed(0)));
    expect([...baselines]).toHaveLength(2);
    expect(words.some((w) => w.text.endsWith("…"))).toBe(true);
  });

  it("leaves a subtitle that fits untouched", async () => {
    const words = await wordsOf("Retirement Summary", "Base Case");
    expect(words.map((w) => w.text).join(" ")).toBe("Retirement Summary | Base Case");
  });
});
