import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToBuffer, Document } from "@react-pdf/renderer";
import { ensureFontsRegistered } from "@/components/presentations/shared/fonts";
import { SECTION_ACCENTS } from "@/lib/presentations/theme";
import { TIDBITS } from "@/lib/presentations/tidbits";
import { EarlyYearsTidbitsPagePdf } from "./page-pdf";
import type { EarlyYearsTidbitsPageData } from "@/lib/presentations/pages/early-years-tidbits/types";

/**
 * The WORST case the library PERMITS, not the worst case it currently holds.
 * `tidbits.test.ts` caps a body at 320 characters and nothing caps a title, so
 * six cards at that cap are what this sheet has to survive — today's longest
 * body is 230, and a test built on that would go green and stay green right up
 * until someone wrote a perfectly legal 320-character one.
 */
const LONGEST_TITLE = "Early-career tax rates are often the lowest you will ever see";
const MAX_BODY =
  "Money left in cash loses purchasing power every year prices rise, and the gap compounds quietly. " +
  "Holding some cash for near-term needs and an emergency fund makes sense; holding every long-term " +
  "dollar in cash shrinks what those dollars will buy decades from now, long after anyone " +
  "remembers deciding to leave them there.";

/** Six cards at the cap — the fit question. */
const worstCase = Array.from({ length: 6 }, (_, i) => ({
  id: `t${i}`,
  title: `${LONGEST_TITLE} ${i + 1}`,
  body: MAX_BODY,
  topic: "risk" as const,
}));

/**
 * Six cards whose titles fit one printed line — the "does every card print"
 * question. It has to be a separate fixture: a title long enough to wrap is
 * broken across two lines by `pdftotext`, and with two columns side by side the
 * second half of card 1's title lands next to the second half of card 2's, so
 * no `toContain` on the whole string can pass on correct output. Fit and
 * presence are two questions and one fixture cannot ask both.
 */
const readable = Array.from({ length: 6 }, (_, i) => ({
  id: `r${i}`,
  title: `Note number ${i + 1}`,
  body: `Body of note ${i + 1}.`,
  topic: "risk" as const,
}));

async function textOf(data: EarlyYearsTidbitsPageData): Promise<string> {
  ensureFontsRegistered();
  const buf = await renderToBuffer(
    <Document>
      {EarlyYearsTidbitsPagePdf({
        data,
        firmName: "Ethos Financial Group",
        clientName: "Cooper Sample",
        reportDate: "August 20, 2026",
        pageIndex: 9,
        totalPages: 9,
        accent: SECTION_ACCENTS["Early Years"],
      })}
    </Document>,
  );
  const dir = mkdtempSync(join(tmpdir(), "ey-tidbits-"));
  try {
    const pdf = join(dir, "p.pdf");
    writeFileSync(pdf, buf);
    execFileSync("pdftotext", ["-layout", pdf, join(dir, "p.txt")]);
    return readFileSync(join(dir, "p.txt"), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("EarlyYearsTidbitsPagePdf", () => {
  it("keeps the worst-case fixture AT the cap the copy rule allows", () => {
    // Guards the guard. If someone raises or lowers the 320-character rule in
    // `tidbits.ts`, this fixture stops being the worst case and the fit test
    // below quietly starts measuring something easier than reality.
    expect(MAX_BODY.length).toBeGreaterThan(300);
    expect(MAX_BODY.length).toBeLessThanOrEqual(320);
    expect(LONGEST_TITLE.length).toBeGreaterThanOrEqual(
      Math.max(...TIDBITS.map((t) => t.title.length)),
    );
  });

  it("prints all six cards, title and body", async () => {
    const text = await textOf({ tidbits: readable });
    for (const t of readable) {
      expect(text).toContain(t.title);
      expect(text).toContain(t.body);
    }
  });

  it("stays on one sheet with six cards at the copy cap", async () => {
    // `pdftotext` emits a form feed per page; six cards must not spill to a
    // second. `estimate-page-count.ts` promises one sheet and nothing else
    // holds it to that.
    const text = await textOf({ tidbits: worstCase });
    expect(text.split("\f").filter((p) => p.trim().length > 0)).toHaveLength(1);
    // …and the last card's body actually reached the paper, rather than the
    // page fitting because react-pdf clipped it. A page count cannot see
    // clipping.
    expect(text).toContain("remembers deciding to leave them there.");
  });

  it("says so rather than printing a heading over blank paper", async () => {
    const text = await textOf({ tidbits: [] });
    expect(text).toContain("No notes were picked");
    expect(text).not.toContain("General financial education");
  });
});
