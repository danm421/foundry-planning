import { describe, it, expect } from "vitest";
import { emptyTaxReturnFacts, type TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { mergeDocuments } from "../merge-documents";
import type { MergeDocument } from "../types";

function doc(
  id: string,
  role: MergeDocument["role"],
  mutate: (f: TaxReturnFacts) => void,
): MergeDocument {
  const facts = emptyTaxReturnFacts(2025);
  mutate(facts);
  return { id, role, taxYear: 2025, facts };
}

describe("mergeDocuments — scalars", () => {
  it("null-fills across documents without conflict", () => {
    const a = doc("a", "full_return", (f) => { f.income.wages = 250000; });
    const b = doc("b", "full_return", (f) => { f.income.taxableInterest = 8000; });

    const result = mergeDocuments(2025, [a, b]);

    expect(result.facts.income.wages).toBe(250000);
    expect(result.facts.income.taxableInterest).toBe(8000);
    expect(result.conflicts).toHaveLength(0);
    expect(result.provenance["income.wages"]).toBe("a");
    expect(result.provenance["income.taxableInterest"]).toBe("b");
  });

  it("records a real conflict rather than silently picking", () => {
    const a = doc("a", "full_return", (f) => { f.income.agi = 412000; });
    const b = doc("b", "full_return", (f) => { f.income.agi = 418500; });

    const result = mergeDocuments(2025, [a, b]);

    // Same role: last document wins, but the loser is recorded.
    expect(result.facts.income.agi).toBe(418500);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      path: "income.agi",
      winner: { documentId: "b", value: 418500 },
      losers: [{ documentId: "a", value: 412000 }],
    });
  });

  it("does not treat an equal value from two documents as a conflict", () => {
    const a = doc("a", "full_return", (f) => { f.income.agi = 412000; });
    const b = doc("b", "full_return", (f) => { f.income.agi = 412000; });

    expect(mergeDocuments(2025, [a, b]).conflicts).toHaveLength(0);
  });
});

describe("mergeDocuments — aggregate protection", () => {
  it("refuses to let a W-2 move income.wages", () => {
    const ret = doc("ret", "full_return", (f) => { f.income.wages = 250000; });
    const w2 = doc("w2", "w2", (f) => { f.income.wages = 90000; });

    const result = mergeDocuments(2025, [ret, w2]);

    expect(result.facts.income.wages).toBe(250000);
    expect(result.conflicts).toHaveLength(0); // never weighed — not a conflict
    expect(result.dropped).toContainEqual(
      expect.objectContaining({ path: "income.wages", documentId: "w2" }),
    );
  });

  it("refuses a supporting document's 1040 scalar even when no return is present", () => {
    const k1 = doc("k1", "k1", (f) => { f.income.scheduleENet = 42000; });

    const result = mergeDocuments(2025, [k1]);

    expect(result.facts.income.scheduleENet).toBeNull();
    expect(result.dropped).toHaveLength(1);
  });

  it("ignores 'other' documents entirely", () => {
    const other = doc("o", "other", (f) => { f.income.wages = 1; });
    const result = mergeDocuments(2025, [other]);
    expect(result.facts.income.wages).toBeNull();
    expect(result.dropped).toHaveLength(0);
  });

  it("skips a document whose facts failed to parse", () => {
    const broken: MergeDocument = { id: "x", role: "full_return", taxYear: 2025, facts: null };
    const good = doc("g", "full_return", (f) => { f.income.wages = 5; });
    expect(mergeDocuments(2025, [broken, good]).facts.income.wages).toBe(5);
  });
});
