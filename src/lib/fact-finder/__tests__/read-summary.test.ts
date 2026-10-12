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
    expect(out.summary).toBe("Read 3 documents. 2 sections have values; 1 value to check; 1 link to confirm.");
    expect(out.caveats).toEqual([
      'Left out "Total Accounts": It repeats 3 accounts above.',
      "1 holding couldn't be matched to an account — pick one under Unassigned holdings.",
      "Couldn't read scan.pdf: Couldn't read any text from this file.",
      "This PDF had no text layer, so its text was read with OCR — check the figures.",
    ]);
  });

  it("keeps it short when there's nothing to check", () => {
    const out = buildReadSummary({ state: emptyFactFinderState(), decisions: [], filesRead: 1, failed: [], caveats: [] });
    expect(out).toEqual({ summary: "Read 1 document. 0 sections have values.", caveats: [] });
  });
});
