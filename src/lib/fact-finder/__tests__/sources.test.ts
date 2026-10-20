// src/lib/fact-finder/__tests__/sources.test.ts
import { describe, expect, it } from "vitest";
import { stampSources } from "../sources";
import { emptyFactFinderState } from "../state";
import { CLAUDE_FILE_ID, type FactFinderState } from "../types";

function fixture(): FactFinderState {
  const s = emptyFactFinderState();
  return {
    ...s,
    sections: {
      ...s.sections,
      cash: [
        { id: "c1", cells: { accountName: { value: "Joint Checking", by: "chat", pinned: true }, currentValue: { value: null, by: "chat" } }, sourceFileIds: [] },
        { id: "c2", cells: { accountName: { value: "Savings", by: "advisor", pinned: true } }, sourceFileIds: [] },
      ],
    },
  };
}

const stamp = { sectionId: "cash", rowId: "c1", columnId: "accountName", documentName: "Schwab statement March 2026.pdf" };

describe("stampSources", () => {
  it("stamps a Claude source on the named cell", () => {
    const before = fixture();
    const after = stampSources(before, [{ ...stamp, page: 3, quote: "Ending value $412,000.00" }]);
    expect(after.sections.cash[0].cells.accountName.source).toEqual({
      fileId: CLAUDE_FILE_ID,
      documentName: "Schwab statement March 2026.pdf",
      page: 3,
      snippet: "Ending value $412,000.00",
    });
    expect(after.sections.cash[1]).toBe(before.sections.cash[1]);
    expect(after.sections.people).toBe(before.sections.people);
    expect(before.sections.cash[0].cells.accountName.source).toBeUndefined();
  });

  it("ignores a stamp for an empty cell or a missing row", () => {
    const before = fixture();
    const after = stampSources(before, [
      { ...stamp, columnId: "currentValue" },
      { ...stamp, columnId: "owner" },
      { ...stamp, rowId: "nope" },
      { ...stamp, sectionId: "nope" },
    ]);
    expect(after).toEqual(before);
    expect(after.sections.cash[0]).toBe(before.sections.cash[0]);
  });

  it("cuts a long quote to 200 characters", () => {
    const after = stampSources(fixture(), [{ ...stamp, quote: "x".repeat(300) }]);
    expect(after.sections.cash[0].cells.accountName.source?.snippet).toHaveLength(200);
  });
});
