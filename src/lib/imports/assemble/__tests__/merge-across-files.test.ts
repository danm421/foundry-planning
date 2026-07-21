import { describe, it, expect } from "vitest";
import { mergeAcrossFiles } from "../merge-across-files";
import type { ExtractionResult } from "@/lib/extraction/types";

function er(fileName: string, extracted: Partial<ExtractionResult["extracted"]>): ExtractionResult {
  return {
    documentType: "account_statement", fileName, promptVersion: "test", warnings: [],
    extracted: { accounts: [], incomes: [], expenses: [], liabilities: [], entities: [], lifePolicies: [], wills: [], ...extracted },
  };
}

describe("mergeAcrossFiles", () => {
  it("collapses the same account seen on two statements (custodian+last4)", () => {
    const r = mergeAcrossFiles({
      f1: er("stmt-jan.pdf", { accounts: [{ name: "401k", custodian: "Fidelity", accountNumberLast4: "1234", value: 450000, category: "retirement" }] }),
      f2: er("stmt-feb.pdf", { accounts: [{ name: "Fidelity 401k", custodian: "fidelity", accountNumberLast4: "1234", value: 455000, category: "retirement", basis: 300000 }] }),
    });
    expect(r.payload.accounts).toHaveLength(1);
    // richer row (has basis) wins
    expect(r.payload.accounts[0].basis).toBe(300000);
    expect(r.payload.warnings.some((w) => w.includes("Merged"))).toBe(true);
    expect(r.mergedFileCount).toBe(2);
  });

  it("keeps two genuinely different accounts at the same custodian", () => {
    const r = mergeAcrossFiles({
      f1: er("a.pdf", { accounts: [{ name: "401k", custodian: "Fidelity", accountNumberLast4: "1111", value: 1, category: "retirement" }] }),
      f2: er("b.pdf", { accounts: [{ name: "IRA", custodian: "Fidelity", accountNumberLast4: "2222", value: 2, category: "retirement" }] }),
    });
    expect(r.payload.accounts).toHaveLength(2);
  });

  it("does not merge accounts lacking custodian+last4", () => {
    const r = mergeAcrossFiles({
      f1: er("a.pdf", { accounts: [{ name: "Brokerage", value: 100, category: "taxable" }] }),
      f2: er("b.pdf", { accounts: [{ name: "Brokerage", value: 100, category: "taxable" }] }),
    });
    expect(r.payload.accounts).toHaveLength(2);
  });

  it("unions non-null fields on merge instead of a whole-row swap — the poorer row's unique field survives", () => {
    const r = mergeAcrossFiles({
      // Richer overall (5 fields: name, custodian, last4, value, category +
      // basis = 6), but lacks growthRate.
      f1: er("stmt-jan.pdf", {
        accounts: [
          {
            name: "401k",
            custodian: "Fidelity",
            accountNumberLast4: "1234",
            value: 450000,
            category: "retirement",
            basis: 300000,
          },
        ],
      }),
      // Poorer overall (5 fields), but carries growthRate, which the richer
      // row above does not have.
      f2: er("stmt-feb.pdf", {
        accounts: [
          {
            name: "Fidelity 401k",
            custodian: "fidelity",
            accountNumberLast4: "1234",
            value: 455000,
            growthRate: 0.06,
          },
        ],
      }),
    });
    expect(r.payload.accounts).toHaveLength(1);
    // Richer row's field wins the row.
    expect(r.payload.accounts[0].basis).toBe(300000);
    expect(r.payload.accounts[0].category).toBe("retirement");
    // Poorer row's unique field must survive the merge (union, not swap).
    expect(r.payload.accounts[0].growthRate).toBe(0.06);
  });
});
