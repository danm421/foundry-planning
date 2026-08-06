import { describe, it, expect, vi } from "vitest";
import { emptyTaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { assembleFacts, recomputeFacts, MissingTaxReturnStateError } from "../recompute";
import type { MergeDocument } from "../merge/types";

// Drives getState → null without touching a database. `@/db` builds its
// Neon Pool lazily at import time, so nothing connects here either way —
// this mock exists so `listDocuments`/`getState` don't have to.
vi.mock("../documents-store", () => ({
  listDocuments: vi.fn(async () => []),
  rowToMergeDocument: vi.fn(),
  getState: vi.fn(async () => null),
}));

describe("assembleFacts", () => {
  it("is the identity for a single document with no overrides", () => {
    const facts = emptyTaxReturnFacts(2025);
    facts.income.wages = 250000;
    facts.income.agi = 412000;
    const doc: MergeDocument = { id: "a", role: "full_return", taxYear: 2025, facts };

    expect(assembleFacts(2025, [doc], {}).facts).toEqual(facts);
  });

  it("reproduces a hand-edited return from one document plus its diff", () => {
    // This is the backfill's correctness property: an existing row becomes one
    // synthetic document plus diff(facts, extractedFacts), and recompute must
    // return the original `facts` unchanged.
    const extracted = emptyTaxReturnFacts(2025);
    extracted.income.wages = 250000;
    extracted.income.agi = 412000;

    const corrected = structuredClone(extracted);
    corrected.income.agi = 418500;

    const doc: MergeDocument = { id: "a", role: "full_return", taxYear: 2025, facts: extracted };
    const overrides = { "income.agi": 418500 };

    expect(assembleFacts(2025, [doc], overrides).facts).toEqual(corrected);
  });

  it("keeps the advisor's edit when a later document disagrees", () => {
    const a = emptyTaxReturnFacts(2025);
    a.income.agi = 412000;
    const b = emptyTaxReturnFacts(2025);
    b.income.agi = 415000;

    const result = assembleFacts(2025, [
      { id: "a", role: "full_return", taxYear: 2025, facts: a },
      { id: "b", role: "full_return", taxYear: 2025, facts: b },
    ], { "income.agi": 418500 });

    expect(result.facts.income.agi).toBe(418500);
    expect(result.provenance["income.agi"]).toBe("advisor");
    // The document-level disagreement is still reported for the review form.
    expect(result.conflicts.map((c) => c.path)).toContain("income.agi");
  });

  it("produces facts that satisfy the strict schema", async () => {
    const { taxReturnFactsSchema } = await import("@/lib/schemas/tax-return-facts");
    const facts = emptyTaxReturnFacts(2025);
    facts.k1s = [{
      entityName: "Ridge Partners LLC", ein: "12-3456789", entityType: "partnership",
      ordinaryBusinessIncome: 42000, rentalIncome: null, guaranteedPayments: 30000,
      section179: null, w2WagesFromEntity: null, qbiIncome: 42000, isSstb: false,
    }];
    const result = assembleFacts(2025, [
      { id: "a", role: "full_return", taxYear: 2025, facts },
    ], { "k1s[12-3456789].w2WagesFromEntity": 85000 });

    expect(taxReturnFactsSchema.safeParse(result.facts).success).toBe(true);
    // Pins that the override actually LANDED, not just that the shape still
    // parses — a schema-satisfying result is necessary but not sufficient,
    // since w2WagesFromEntity: null also parses.
    expect(result.facts.k1s[0].w2WagesFromEntity).toBe(85000);
  });
});

describe("recomputeFacts", () => {
  it("throws MissingTaxReturnStateError rather than silently discarding advisor corrections when no state row exists", async () => {
    // getState() is mocked to null above, standing in for an un-backfilled
    // tax_return_state row. A `state?.factsOverrides ?? {}` rewrite would
    // swallow this case and recompute against an empty override map instead
    // of failing loudly — this test exists to pin the throw so that rewrite
    // cannot pass silently.
    await expect(
      recomputeFacts("11111111-1111-1111-1111-111111111111", 2025),
    ).rejects.toThrow(MissingTaxReturnStateError);
  });
});
