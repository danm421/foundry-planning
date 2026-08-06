import { describe, it, expect } from "vitest";
import { emptyTaxReturnFacts, type TaxReturnFacts } from "@/lib/schemas/tax-return-facts";
import { mergeDocuments } from "../merge-documents";
import type { MergeDocument } from "../types";

function doc(id: string, role: MergeDocument["role"], mutate: (f: TaxReturnFacts) => void): MergeDocument {
  const facts = emptyTaxReturnFacts(2025);
  mutate(facts);
  return { id, role, taxYear: 2025, facts };
}

const ridge = {
  entityName: "Ridge Partners LLC", ein: "12-3456789",
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
  });

  it("updates rather than duplicates when the same K-1 is re-uploaded", () => {
    const a = doc("a", "k1", (f) => { f.k1s = [ridge]; });
    const b = doc("b", "k1", (f) => {
      f.k1s = [{ ...ridge, ordinaryBusinessIncome: 45000 }];
    });

    const result = mergeDocuments(2025, [a, b]);

    expect(result.facts.k1s).toHaveLength(1);
    expect(result.facts.k1s[0].ordinaryBusinessIncome).toBe(45000);
    expect(result.conflicts.map((c) => c.path))
      .toContain("k1s[12-3456789].ordinaryBusinessIncome");
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

  it("lets a full_return document contribute businesses too", () => {
    const a = doc("a", "full_return", (f) => {
      f.businesses = [{ name: "Mueller Consulting", netProfit: 180000,
                        grossReceipts: 240000, totalExpenses: 60000,
                        depreciation: 4000, isSstb: false }];
    });

    const result = mergeDocuments(2025, [a]);

    expect(result.facts.businesses).toHaveLength(1);
    expect(result.provenance["businesses[name:mueller consulting].netProfit"]).toBe("a");
  });

  it("does not let a w2 document write entity arrays", () => {
    const w2 = doc("w2", "w2", (f) => { f.k1s = [ridge]; });
    const result = mergeDocuments(2025, [w2]);
    expect(result.facts.k1s).toHaveLength(0);
  });
});
