import { describe, expect, it } from "vitest";

import { candidatesForRow } from "../expense-slot-candidates";
import type { MatchAnnotation } from "../types";

const CANDS = [
  { id: "slot-current", name: "Current Living Expenses" },
  { id: "slot-retirement", name: "Retirement Living Expenses" },
];

describe("candidatesForRow", () => {
  it("returns all slots when nothing is claimed", () => {
    const matches: Array<MatchAnnotation | undefined> = [undefined, undefined];
    expect(candidatesForRow(0, matches, CANDS)).toEqual(CANDS);
  });

  it("excludes a slot claimed by another row", () => {
    const matches: Array<MatchAnnotation | undefined> = [
      { kind: "exact", existingId: "slot-current" },
      undefined,
    ];
    expect(candidatesForRow(1, matches, CANDS)).toEqual([
      { id: "slot-retirement", name: "Retirement Living Expenses" },
    ]);
  });

  it("keeps a slot claimed by the row itself", () => {
    const matches: Array<MatchAnnotation | undefined> = [
      { kind: "exact", existingId: "slot-current" },
      undefined,
    ];
    expect(candidatesForRow(0, matches, CANDS)).toEqual(CANDS);
  });

  it("ignores non-exact matches", () => {
    const matches: Array<MatchAnnotation | undefined> = [
      { kind: "new" },
      { kind: "fuzzy", candidates: [] },
    ];
    expect(candidatesForRow(0, matches, CANDS)).toEqual(CANDS);
  });
});
