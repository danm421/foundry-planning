import { describe, it, expect } from "vitest";
import {
  emptyTaxReturnFacts, taxReturnFactsSchema, type TaxReturnFacts,
} from "@/lib/schemas/tax-return-facts";
import { mergeDocuments } from "../merge-documents";
import type { MergeDocument } from "../types";

function doc(id: string, role: MergeDocument["role"], mutate: (f: TaxReturnFacts) => void): MergeDocument {
  const facts = emptyTaxReturnFacts(2025);
  mutate(facts);
  return { id, role, taxYear: 2025, facts };
}

const ridge = {
  entityId: null, entityName: "Ridge Partners LLC", ein: "12-3456789",
  entityType: "partnership" as const, ordinaryBusinessIncome: 42000,
  rentalIncome: null, guaranteedPayments: 30000, section179: null,
  w2WagesFromEntity: null, qbiIncome: 42000, isSstb: false,
};

describe("mergeDocuments — entity arrays", () => {
  it("unions K-1s from separate documents instead of replacing", () => {
    const a = doc("a", "k1", (f) => { f.k1s = [ridge]; });
    const b = doc("b", "k1", (f) => {
      f.k1s = [{ ...ridge, entityName: "Summit Holdings Inc", ein: "98-7654321",
                 entityType: "s_corp", guaranteedPayments: null }];
    });

    const result = mergeDocuments(2025, [a, b]);

    expect(result.facts.k1s).toHaveLength(2);
    expect(result.facts.k1s.map((k) => k.ein).sort())
      .toEqual(["12-3456789", "98-7654321"]);
    expect(taxReturnFactsSchema.safeParse(result.facts).success).toBe(true);
  });

  it("updates rather than duplicates when the same K-1 is re-uploaded", () => {
    const a = doc("a", "k1", (f) => { f.k1s = [ridge]; });
    const b = doc("b", "k1", (f) => {
      f.k1s = [{ ...ridge, ordinaryBusinessIncome: 45000 }];
    });

    const result = mergeDocuments(2025, [a, b]);

    expect(result.facts.k1s).toHaveLength(1);
    expect(result.facts.k1s[0].ordinaryBusinessIncome).toBe(45000);
    // Exact, not toContain: every other field restates the same value across
    // a and b, so this must be the ONLY conflict — not a stand-in for "this
    // path is somewhere in the list."
    expect(result.conflicts.map((c) => c.path))
      .toEqual(["k1s[12-3456789].ordinaryBusinessIncome"]);
  });

  it("does not let a newer document ERASE an entity field it simply did not read", () => {
    // The entity-array half of the null-fill rule. Re-uploading a corrected
    // K-1 whose extraction happens to read fewer boxes than the first must not
    // blank the values the earlier document supplied — which is the whole
    // reason the union layer exists rather than last-document-wins.
    //
    // The equivalent rule on the SCALAR path is pinned in merge-documents.test.ts;
    // this side was unpinned, so deleting the `value === null` skip in
    // mergeEntities left the entire suite green.
    const a = doc("a", "k1", (f) => { f.k1s = [ridge]; });               // guaranteedPayments: 30000
    const b = doc("b", "k1", (f) => {
      f.k1s = [{ ...ridge, ordinaryBusinessIncome: 45000, guaranteedPayments: null }];
    });

    const result = mergeDocuments(2025, [a, b]);

    expect(result.facts.k1s).toHaveLength(1);
    expect(result.facts.k1s[0].guaranteedPayments).toBe(30000);
    // The field b DID read still wins, so this pins the null-skip specifically
    // rather than "b never overwrites a".
    expect(result.facts.k1s[0].ordinaryBusinessIncome).toBe(45000);
    // A null is an absence, not a disagreement — it must not be reported as a
    // conflict for the advisor to resolve.
    expect(result.conflicts.map((c) => c.path))
      .toEqual(["k1s[12-3456789].ordinaryBusinessIncome"]);
  });

  it("emits exactly one conflict per path, with the true final winner, across 3+ documents", () => {
    const a = doc("a", "k1", (f) => { f.k1s = [{ ...ridge, ordinaryBusinessIncome: 42000 }]; });
    const b = doc("b", "k1", (f) => { f.k1s = [{ ...ridge, ordinaryBusinessIncome: 45000 }]; });
    const c = doc("c", "k1", (f) => { f.k1s = [{ ...ridge, ordinaryBusinessIncome: 48000 }]; });

    const result = mergeDocuments(2025, [a, b, c]);

    expect(result.facts.k1s).toHaveLength(1);
    expect(result.facts.k1s[0].ordinaryBusinessIncome).toBe(48000);
    // A pairwise implementation would emit TWO records for this path (one
    // claiming the merge kept 45000). There must be exactly one, and its
    // winner must be the value the merge actually kept.
    expect(result.conflicts).toEqual([
      {
        path: "k1s[12-3456789].ordinaryBusinessIncome",
        winner: { documentId: "c", value: 48000 },
        losers: [
          { documentId: "a", value: 42000 },
          { documentId: "b", value: 45000 },
        ],
      },
    ]);
  });

  it("keeps every earlier document's attribution even when adjacent values repeat", () => {
    // a and b both state 42000 (no pairwise transition between them looks
    // like a conflict); c then changes it. A pairwise implementation
    // silently reassigns provenance to b when b restates a's value, so by
    // the time c differs, a's attribution is already lost — only b shows up
    // as a loser. Deferred resolution must list BOTH a and b.
    const a = doc("a", "k1", (f) => { f.k1s = [{ ...ridge, ordinaryBusinessIncome: 42000 }]; });
    const b = doc("b", "k1", (f) => { f.k1s = [{ ...ridge, ordinaryBusinessIncome: 42000 }]; });
    const c = doc("c", "k1", (f) => { f.k1s = [{ ...ridge, ordinaryBusinessIncome: 45000 }]; });

    const result = mergeDocuments(2025, [a, b, c]);

    expect(result.conflicts).toEqual([
      {
        path: "k1s[12-3456789].ordinaryBusinessIncome",
        winner: { documentId: "c", value: 45000 },
        losers: [
          { documentId: "a", value: 42000 },
          { documentId: "b", value: 42000 },
        ],
      },
    ]);
  });

  it("matches the same entity across EIN-less documents by normalized name", () => {
    const a = doc("a", "k1", (f) => { f.k1s = [{ ...ridge, ein: null }]; });
    const b = doc("b", "k1", (f) => {
      f.k1s = [{ ...ridge, ein: null, entityName: "RIDGE PARTNERS, L.L.C.", qbiIncome: 44000 }];
    });

    const result = mergeDocuments(2025, [a, b]);

    expect(result.facts.k1s).toHaveLength(1);
    expect(result.facts.k1s[0].qbiIncome).toBe(44000);
  });

  it("keeps an unkeyable entity rather than discarding it", () => {
    const a = doc("a", "k1", (f) => {
      f.k1s = [{ ...ridge, ein: null, entityName: null }];
    });

    const result = mergeDocuments(2025, [a]);

    expect(result.facts.k1s).toHaveLength(1);
  });
});

describe("mergeDocuments — stamped entity identity", () => {
  it("stamps every merged entity with the key it was filed under", () => {
    const a = doc("a", "k1", (f) => { f.k1s = [ridge]; });
    const b = doc("b", "full_return", (f) => {
      f.businesses = [{ entityId: null, name: "Mueller Consulting", netProfit: 90000,
                        grossReceipts: null, totalExpenses: null, depreciation: null,
                        isSstb: false }];
    });

    const result = mergeDocuments(2025, [a, b]);

    // The stamp is what makes the entity addressable AFTER a rename: every
    // later layer reads `entityId` instead of re-deriving from OCR'd text.
    expect(result.facts.k1s[0].entityId).toBe("12-3456789");
    expect(result.facts.businesses[0].entityId).toBe("name:mueller consulting");
    expect(taxReturnFactsSchema.safeParse(result.facts).success).toBe(true);
  });

  it("stamps an UNKEYABLE entity with its synthetic key, making it addressable", () => {
    // Before the stamp this entity was kept by the merge but could never be
    // edited: `entityKey` returned null for it, so `diffOverrides` skipped it
    // and `applyOverrides` could never match a `doc:` key.
    const a = doc("a", "k1", (f) => {
      f.k1s = [{ ...ridge, ein: null, entityName: null }];
    });

    const result = mergeDocuments(2025, [a]);

    expect(result.facts.k1s[0].entityId).toBe("doc:a:0");
  });

  it("never treats a document's own entityId as a merged value", () => {
    // A document echoing back a stale id must not re-key the merged entity nor
    // show up as a field conflict for the advisor to resolve.
    const a = doc("a", "k1", (f) => { f.k1s = [{ ...ridge, entityId: "stale-a" }]; });
    const b = doc("b", "k1", (f) => { f.k1s = [{ ...ridge, entityId: "stale-b" }]; });

    const result = mergeDocuments(2025, [a, b]);

    expect(result.facts.k1s).toHaveLength(1);
    expect(result.facts.k1s[0].entityId).toBe("12-3456789");
    expect(result.conflicts).toEqual([]);
  });

  it("lets a full_return document contribute businesses too", () => {
    const a = doc("a", "full_return", (f) => {
      f.businesses = [{ entityId: null, name: "Mueller Consulting", netProfit: 180000,
                        grossReceipts: 240000, totalExpenses: 60000,
                        depreciation: 4000, isSstb: false }];
    });

    const result = mergeDocuments(2025, [a]);

    expect(result.facts.businesses).toHaveLength(1);
    expect(result.provenance["businesses[name:mueller consulting].netProfit"]).toBe("a");
    expect(taxReturnFactsSchema.safeParse(result.facts).success).toBe(true);
  });

  it("does not let a w2 document write entity arrays, and records why", () => {
    const w2 = doc("w2", "w2", (f) => { f.k1s = [ridge]; });
    const result = mergeDocuments(2025, [w2]);
    expect(result.facts.k1s).toHaveLength(0);
    expect(result.dropped).toContainEqual(
      expect.objectContaining({
        path: "k1s[12-3456789].*",
        documentId: "w2",
        reason: "a w2 document cannot contribute k1s",
      }),
    );
  });
});
