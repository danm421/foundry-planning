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

  it("does NOT merge accounts sharing custodian+last4 when owners differ (FIX 5 — client IRA vs spouse IRA)", () => {
    const r = mergeAcrossFiles({
      f1: er("a.pdf", { accounts: [{ name: "IRA", custodian: "Fidelity", accountNumberLast4: "1234", value: 100000, owner: "client" }] }),
      f2: er("b.pdf", { accounts: [{ name: "IRA", custodian: "Fidelity", accountNumberLast4: "1234", value: 200000, owner: "spouse" }] }),
    });
    expect(r.payload.accounts).toHaveLength(2);
    expect(r.payload.warnings.some((w) => w.includes("Merged"))).toBe(false);
  });

  it("still merges same custodian+last4+owner accounts, and names both values when they differ materially (FIX 5)", () => {
    const r = mergeAcrossFiles({
      f1: er("jan.pdf", { accounts: [{ name: "IRA", custodian: "Fidelity", accountNumberLast4: "1234", value: 100000, owner: "client" }] }),
      f2: er("feb.pdf", { accounts: [{ name: "IRA", custodian: "Fidelity", accountNumberLast4: "1234", value: 250000, owner: "client" }] }),
    });
    expect(r.payload.accounts).toHaveLength(1);
    // Nothing is dropped — the surviving row keeps a real, non-fabricated value.
    expect(typeof r.payload.accounts[0].value).toBe("number");
    const warning = r.payload.warnings.find((w) => w.includes("Merged duplicate account"));
    expect(warning).toBeDefined();
    expect(warning).toContain("100,000");
    expect(warning).toContain("250,000");
  });

  it("merges same custodian+last4+owner accounts within tolerance without the value-conflict wording (FIX 5)", () => {
    const r = mergeAcrossFiles({
      f1: er("jan.pdf", { accounts: [{ name: "401k", custodian: "Fidelity", accountNumberLast4: "1234", value: 450000, owner: "client" }] }),
      f2: er("feb.pdf", { accounts: [{ name: "401k", custodian: "Fidelity", accountNumberLast4: "1234", value: 452000, owner: "client" }] }),
    });
    expect(r.payload.accounts).toHaveLength(1);
    const warning = r.payload.warnings.find((w) => w.includes("Merged duplicate account"));
    expect(warning).toBeDefined();
    expect(warning).not.toContain("differ");
  });

  it("collapses the same account across 3+ files into ONE warning, not one per merge (FIX 6)", () => {
    const r = mergeAcrossFiles({
      f1: er("jan.pdf", { accounts: [{ name: "Schwab Brokerage", custodian: "Schwab", accountNumberLast4: "9911", value: 100000 }] }),
      f2: er("feb.pdf", { accounts: [{ name: "Schwab Brokerage", custodian: "Schwab", accountNumberLast4: "9911", value: 100200 }] }),
      f3: er("mar.pdf", { accounts: [{ name: "Schwab Brokerage", custodian: "Schwab", accountNumberLast4: "9911", value: 100400 }] }),
    });
    expect(r.payload.accounts).toHaveLength(1);
    const mergeWarnings = r.payload.warnings.filter((w) => w.includes("Merged duplicate account"));
    // Before FIX 6 this was 2 warnings ("seen in 2 documents." then "seen in
    // 3 documents.") — both slugifying to the SAME conflict-question id.
    expect(mergeWarnings).toHaveLength(1);
    expect(mergeWarnings[0]).toMatch(/seen in 3 documents/);
  });

  it("still merges same custodian+last4 accounts when neither carries an owner (undefined === undefined)", () => {
    const r = mergeAcrossFiles({
      f1: er("stmt-jan.pdf", { accounts: [{ name: "401k", custodian: "Fidelity", accountNumberLast4: "1234", value: 450000 }] }),
      f2: er("stmt-feb.pdf", { accounts: [{ name: "401k", custodian: "Fidelity", accountNumberLast4: "1234", value: 451000 }] }),
    });
    expect(r.payload.accounts).toHaveLength(1);
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
