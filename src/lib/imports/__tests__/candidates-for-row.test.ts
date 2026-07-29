import { describe, expect, it } from "vitest";

import { candidatesForRow } from "../candidates-for-row";
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

  it("accepts a richer candidate shape and preserves its extra fields", () => {
    const result = candidatesForRow(
      0,
      [undefined, { kind: "exact", existingId: "b" }],
      [
        { id: "a", name: "A", subtitle: "401(k) — Fidelity", score: 0.9 },
        { id: "b", name: "B", subtitle: "IRA — Schwab", score: 0.8 },
      ],
    );
    expect(result).toEqual([
      { id: "a", name: "A", subtitle: "401(k) — Fidelity", score: 0.9 },
    ]);
  });
});
