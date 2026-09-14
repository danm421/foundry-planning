// src/lib/entity-extraction/__tests__/matcher.test.ts
import { describe, it, expect } from "vitest";
import { findEntity } from "@/domain/forge/detail-fields";
import { matchByIdentity } from "../matcher";
import type { CandidateRow } from "../types";

const disability = findEntity("disability_policy")!;
const life = findEntity("life_insurance_policy")!;

function row(values: Record<string, unknown>): CandidateRow {
  return {
    entityId: disability.id,
    rowId: "r1",
    values: Object.entries(values).map(([key, value]) => ({ key, value, snippet: "x", confidence: 0.9 })),
    missingRequired: [],
    rowConfidence: 0.9,
  };
}

const existing = [
  { id: "d1", values: { name: "Group LTD", insured: "client", carrier: "Unum" } },
  { id: "d2", values: { name: "Individual DI", insured: "spouse", carrier: "Guardian" } },
];

describe("matchByIdentity", () => {
  it("matches exactly when every identity field agrees", () => {
    const result = matchByIdentity(disability, row({ name: "Group LTD", insured: "client", carrier: "Unum" }), existing);
    expect(result).toEqual({ kind: "exact", existingId: "d1" });
  });

  it("ignores case and surrounding whitespace on a string identity", () => {
    const result = matchByIdentity(disability, row({ name: "  group ltd ", insured: "client", carrier: "UNUM" }), existing);
    expect(result).toEqual({ kind: "exact", existingId: "d1" });
  });

  it("offers a fuzzy candidate when most of the identity agrees", () => {
    const result = matchByIdentity(disability, row({ name: "Group LTD", insured: "client", carrier: "Unum Group" }), existing);
    expect(result.kind).toBe("fuzzy");
    if (result.kind === "fuzzy") expect(result.candidates[0].id).toBe("d1");
  });

  it("is new when nothing agrees", () => {
    const result = matchByIdentity(disability, row({ name: "Brand New", insured: "client", carrier: "MetLife" }), existing);
    expect(result).toEqual({ kind: "new" });
  });

  it("is new when the client has no rows yet", () => {
    expect(matchByIdentity(disability, row({ name: "Group LTD", insured: "client", carrier: "Unum" }), []))
      .toEqual({ kind: "new" });
  });

  it("is new when an identity value is missing from the candidate", () => {
    expect(matchByIdentity(disability, row({ name: "Group LTD" }), existing)).toEqual({ kind: "new" });
  });

  it("is new for an entity with no identity key at all", () => {
    expect(matchByIdentity(life, row({ name: "Term Life 20" }), existing)).toEqual({ kind: "new" });
  });

  it("never returns a flagged value as an identity match", () => {
    const flagged: CandidateRow = {
      ...row({ insured: "client", carrier: "Unum" }),
      values: [
        { key: "name", value: "Group LTD", snippet: "x", confidence: 0.9, issue: "coercion" },
        { key: "insured", value: "client", snippet: "x", confidence: 0.9 },
        { key: "carrier", value: "Unum", snippet: "x", confidence: 0.9 },
      ],
    };
    expect(matchByIdentity(disability, flagged, existing)).toEqual({ kind: "new" });
  });

  it("returns at most five fuzzy candidates", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `x${i}`,
      values: { name: "Group LTD", insured: "client", carrier: `Carrier ${i}` },
    }));
    const result = matchByIdentity(disability, row({ name: "Group LTD", insured: "client", carrier: "Unum" }), many);
    expect(result.kind).toBe("fuzzy");
    if (result.kind === "fuzzy") expect(result.candidates.length).toBeLessThanOrEqual(5);
  });
});
