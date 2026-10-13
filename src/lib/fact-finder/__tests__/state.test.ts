// src/lib/fact-finder/__tests__/state.test.ts
import { describe, expect, it } from "vitest";
import { findSection } from "../schema";
import {
  REVIEW_THRESHOLD,
  cellNeedsCheck,
  countCellsToCheck,
  countLinksNeedingClick,
  emptyFactFinderState,
  fixedLabelOfRow,
  fixedRowId,
  holdingKey,
  linkNeedsClick,
  locateRow,
  readFactFinderState,
  rowHasValues,
  rowLabel,
  rowValues,
  sameJson,
} from "../state";
import type { ChangeSet } from "../change-set";
import type { FFRow } from "../types";

describe("emptyFactFinderState", () => {
  it("starts every section, with fixed and notes rows already present", () => {
    const s = emptyFactFinderState();
    expect(s.version).toBe(0);
    expect(s.sections.people.map((r) => r.id)).toEqual(["people:Client", "people:Co-client"]);
    expect(s.sections.final_notes.map((r) => r.id)).toEqual(["final_notes:Notes"]);
    expect(s.sections.cash).toEqual([]);
    expect(s.removed).toEqual([]);
    expect(s.unassignedHoldings).toEqual([]);
  });
});

describe("readFactFinderState", () => {
  it("returns an empty fact finder when the import has no slice", () => {
    expect(readFactFinderState({ chat: { surface: "chat" } })).toEqual(emptyFactFinderState());
    expect(readFactFinderState(null)).toEqual(emptyFactFinderState());
  });

  it("keeps stored rows and fills in sections and fixed rows added since", () => {
    const stored = {
      factFinder: {
        version: 7,
        sections: { cash: [{ id: "r1", cells: {}, sourceFileIds: [] }], people: [] },
        removed: [],
        readings: {},
      },
    };
    const s = readFactFinderState(stored);
    expect(s.version).toBe(7);
    expect(s.sections.cash.map((r) => r.id)).toEqual(["r1"]);
    expect(s.sections.people.map((r) => r.id)).toEqual(["people:Client", "people:Co-client"]);
    expect(s.sections.taxable).toEqual([]);
    expect(s.unassignedHoldings).toEqual([]);
    expect(s.transcript).toEqual([]);
    expect(s.undo).toEqual({});
  });

  it("carries a stored change set as-is, and adds no key when there is none", () => {
    const changeSet: ChangeSet = {
      builtAtVersion: 3,
      builtAt: "2026-10-13T12:00:00.000Z",
      lines: [],
      notices: ["2 holdings aren't assigned to an account and won't be saved."],
    };
    expect(readFactFinderState({ factFinder: { version: 3, changeSet } }).changeSet).toEqual(changeSet);
    expect("changeSet" in readFactFinderState({ factFinder: { version: 3 } })).toBe(false);
  });
});

const row = (cells: FFRow["cells"], extra: Partial<FFRow> = {}): FFRow => ({
  id: "r1",
  cells,
  sourceFileIds: [],
  ...extra,
});

describe("row helpers", () => {
  it("builds and parses fixed row ids", () => {
    expect(fixedRowId("ss", "Co-client")).toBe("ss:Co-client");
    expect(fixedLabelOfRow("ss", "ss:Co-client")).toBe("Co-client");
    expect(fixedLabelOfRow("ss", "abc")).toBeNull();
  });

  it("reads values, skipping blanks", () => {
    const r = row({
      accountName: { value: "IRA", by: "document" },
      last4: { value: null, by: "advisor", pinned: true },
      custodian: { value: "", by: "document" },
    });
    expect(rowValues(r)).toEqual({ accountName: "IRA" });
    expect(rowHasValues(r)).toBe(true);
    expect(rowHasValues(row({}))).toBe(false);
  });

  it("labels a row by its first filled column, or its fixed label", () => {
    const cash = findSection("cash")!;
    expect(rowLabel(cash, row({ accountName: { value: "Joint Checking", by: "document" } }))).toBe("Joint Checking");
    expect(rowLabel(cash, row({}))).toBe("Cash Accounts row");
    expect(rowLabel(findSection("ss")!, { id: "ss:Client", cells: {}, sourceFileIds: [] })).toBe("Social Security — Client");
  });

  it("locates a row by id", () => {
    const s = emptyFactFinderState();
    s.sections.cash = [row({})];
    expect(locateRow(s, "r1")).toEqual({ sectionId: "cash", index: 0 });
    expect(locateRow(s, "people:Co-client")).toEqual({ sectionId: "people", index: 1 });
    expect(locateRow(s, "nope")).toBeNull();
  });
});

describe("check-this and link counts", () => {
  it("flags low-confidence or unreadable document values, never advisor values", () => {
    expect(REVIEW_THRESHOLD).toBe(0.7);
    expect(cellNeedsCheck({ value: 5, by: "document", confidence: 0.5 })).toBe(true);
    expect(cellNeedsCheck({ value: "Joint", by: "document", confidence: 1, issue: "notAnOption" })).toBe(true);
    expect(cellNeedsCheck({ value: 5, by: "document", confidence: 0.9 })).toBe(false);
    expect(cellNeedsCheck({ value: 5, by: "advisor", confidence: 0.1, pinned: true })).toBe(false);
    expect(cellNeedsCheck({ value: null, by: "document", confidence: 0.1 })).toBe(false);
  });

  it("counts cells to check and links needing a click across the fact finder", () => {
    const s = emptyFactFinderState();
    s.sections.cash = [
      row({ accountName: { value: "A", by: "document", confidence: 0.4 } }, {
        link: { kind: "existing", recordId: "a1", score: 0.7, confirmed: false, by: "auto" },
      }),
    ];
    expect(countCellsToCheck(s)).toBe(1);
    expect(countLinksNeedingClick(s)).toBe(1);
    expect(linkNeedsClick(s.sections.cash[0])).toBe(true);
  });
});

describe("holdingKey and JSON comparison", () => {
  it("keys holdings by ticker, else by name", () => {
    expect(holdingKey({ ticker: " vti ", name: "Vanguard" })).toBe("t:VTI");
    expect(holdingKey({ ticker: null, name: "Apple  Inc." })).toBe("n:apple inc.");
    expect(holdingKey({ ticker: null, name: null })).toBeNull();
  });

  it("compares JSON regardless of key order and undefined keys", () => {
    expect(sameJson({ a: 1, b: { c: 2, d: undefined } }, { b: { c: 2 }, a: 1 })).toBe(true);
    expect(sameJson([1, 2], [2, 1])).toBe(false);
  });
});
