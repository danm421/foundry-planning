// src/lib/fact-finder/__tests__/read-summary.test.ts
import { describe, expect, it } from "vitest";
import { buildReadSummary } from "../read-summary";
import { emptyFactFinderState } from "../state";

describe("buildReadSummary", () => {
  it("says what was read, what to check and what to confirm, then the caveats", () => {
    const s = emptyFactFinderState();
    s.sections.external = [{ id: "x", cells: { name: { value: "Red Cross", by: "document", confidence: 0.9 } }, sourceFileIds: ["f1"] }];
    s.sections.retirement = [
      {
        id: "r",
        cells: { accountName: { value: "IRA", by: "document", confidence: 0.4 } },
        link: { kind: "existing", recordId: "a1", score: 0.7, confirmed: false, by: "auto" },
        sourceFileIds: ["f2"],
      },
    ];
    s.unassignedHoldings = [
      { id: "h", ticker: "AAPL", name: null, shares: 1, price: null, marketValue: 100, costBasis: null, by: "document", accountHint: "x9999" },
    ];
    const out = buildReadSummary({
      state: s,
      decisions: [{ kind: "excluded", sectionId: "taxable", rowId: "t", label: "Total Accounts", fileId: "f2", reason: "It repeats 3 accounts above." }],
      filesRead: 3,
      failed: [{ fileName: "scan.pdf", reason: "Couldn't read any text from this file." }],
      caveats: ["This PDF had no text layer, so its text was read with OCR — check the figures."],
    });
    expect(out.summary).toBe(
      "Read 3 documents. 1 couldn't be read — Retry it. 1 value to check; 1 link to confirm.",
    );
    expect(out.caveats).toEqual([
      'Left out "Total Accounts": It repeats 3 accounts above.',
      "1 holding couldn't be matched to an account — ask me which account they belong to.",
      "Couldn't read scan.pdf: Couldn't read any text from this file.",
      "This PDF had no text layer, so its text was read with OCR — check the figures.",
    ]);
  });

  it("the summary names documents read, not sections", () => {
    const s = emptyFactFinderState();
    s.sections.external = [{ id: "x", cells: { name: { value: "Red Cross", by: "document", confidence: 0.9 } }, sourceFileIds: ["f1"] }];
    expect(buildReadSummary({ state: s, decisions: [], filesRead: 3, failed: [], caveats: [] }).summary).not.toMatch(/section/);
    expect(buildReadSummary({ state: s, decisions: [], filesRead: 3, failed: [], caveats: [] }).summary).toBe("Read 3 documents.");
  });

  it("unassigned holdings are explained in chat words", () => {
    const s = emptyFactFinderState();
    const h = { id: "h", ticker: "AAPL", name: null, shares: 1, price: null, marketValue: 100, costBasis: null, by: "document" as const, accountHint: "x9999" };
    s.unassignedHoldings = [h, { ...h, id: "h2" }];
    expect(buildReadSummary({ state: s, decisions: [], filesRead: 1, failed: [], caveats: [] }).caveats).toEqual([
      "2 holdings couldn't be matched to an account — ask me which account they belong to.",
    ]);
  });

  it("keeps it short when there's nothing to check", () => {
    const out = buildReadSummary({ state: emptyFactFinderState(), decisions: [], filesRead: 1, failed: [], caveats: [] });
    expect(out).toEqual({ summary: "Read 1 document.", caveats: [] });
  });

  it("never counts a document it couldn't read as read", () => {
    const failed = [
      { fileName: "a.pdf", reason: "Stopped before this file was read." },
      { fileName: "b.pdf", reason: "Couldn't read this document — try again." },
    ];
    expect(buildReadSummary({ state: emptyFactFinderState(), decisions: [], filesRead: 0, failed, caveats: [] })).toEqual({
      summary: "Couldn't read 2 documents — Retry them.",
      caveats: ["Couldn't read a.pdf: Stopped before this file was read.", "Couldn't read b.pdf: Couldn't read this document — try again."],
    });
    expect(buildReadSummary({ state: emptyFactFinderState(), decisions: [], filesRead: 2, failed: failed.slice(1), caveats: [] }).summary).toBe(
      "Read 2 documents. 1 couldn't be read — Retry it.",
    );
  });
});
