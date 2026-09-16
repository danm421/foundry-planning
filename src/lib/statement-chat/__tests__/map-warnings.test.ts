import { describe, expect, it } from "vitest";

import { summarizeMapWarnings, type MapWarning } from "../map-warnings";

const redaction = (n: number) =>
  `Redacted ${n} SSN-like value(s) from this document before sending it to the AI extractor.`;

function w(source: string, message: string): MapWarning {
  return { source, message };
}

describe("summarizeMapWarnings", () => {
  it("sums every redaction notice into one line", () => {
    const lines = summarizeMapWarnings([
      w("a.pdf", redaction(16)),
      w("b.pdf", redaction(2)),
      w("c.pdf", redaction(4)),
    ]);

    expect(lines).toEqual([
      "Redacted 22 SSN-like values across 3 documents before sending them to the AI extractor.",
    ]);
  });

  it("names the file when only one was redacted", () => {
    expect(summarizeMapWarnings([w("a.pdf", redaction(1))])).toEqual([
      "Redacted 1 SSN-like value from a.pdf before sending it to the AI extractor.",
    ]);
  });

  it("collapses one shared problem into a line naming every file", () => {
    const message = "This document produced no readable text.";
    const lines = summarizeMapWarnings([
      w("voya.docx", message),
      w("stantec.docx", message),
      w("gensler.jpg", message),
    ]);

    expect(lines).toEqual([
      `${message} — 3 documents: voya.docx, stantec.docx, and gensler.jpg`,
    ]);
  });

  it("counts the overflow past three named files", () => {
    const message = "File not found";
    const lines = summarizeMapWarnings(
      ["a.pdf", "b.pdf", "c.pdf", "d.pdf", "e.pdf"].map((f) => w(f, message)),
    );

    expect(lines).toEqual(["File not found — 5 documents: a.pdf, b.pdf, c.pdf, and 2 more"]);
  });

  it("punctuates its file list the way the import narration does", () => {
    // Both render on the same screen — the narration summary above the table
    // and this card below it — so they must not disagree about the Oxford
    // comma. `joinWithAnd` in narrate.ts is the one that decides.
    const message = "File not found";
    expect(summarizeMapWarnings([w("a.pdf", message), w("b.pdf", message)])).toEqual([
      "File not found — 2 documents: a.pdf and b.pdf",
    ]);
  });

  it("keeps a lone problem attributed to its file", () => {
    expect(summarizeMapWarnings([w("life.pdf", "Could not classify this document.")])).toEqual([
      "life.pdf: Could not classify this document.",
    ]);
  });

  it("keeps distinct messages apart and puts the redaction disclosure last", () => {
    const lines = summarizeMapWarnings([
      w("a.pdf", redaction(16)),
      w("b.pdf", "File not found"),
      w("c.pdf", redaction(2)),
      w("d.pdf", "File not found"),
      w("e.pdf", "Only the first 30 of 53 pages were read; data on later pages was skipped."),
    ]);

    expect(lines).toEqual([
      "File not found — 2 documents: b.pdf and d.pdf",
      "e.pdf: Only the first 30 of 53 pages were read; data on later pages was skipped.",
      "Redacted 18 SSN-like values across 2 documents before sending them to the AI extractor.",
    ]);
  });

  it("does not double-count a file that reported the same problem twice", () => {
    const message = "A region held no readable text.";
    expect(summarizeMapWarnings([w("a.pdf", message), w("a.pdf", message)])).toEqual([
      `a.pdf: ${message}`,
    ]);
  });

  it("returns nothing for no warnings", () => {
    expect(summarizeMapWarnings([])).toEqual([]);
  });
});
