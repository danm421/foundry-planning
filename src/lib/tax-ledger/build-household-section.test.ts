// src/lib/tax-ledger/build-household-section.test.ts
import { describe, expect, it } from "vitest";
import type { ProjectionYear } from "@/engine/types";
import type { CellDrillContext } from "@/lib/tax/cell-drill/types";
import { buildHouseholdSection } from "./build-household-section";

const ctx = {
  accountNames: { ira: "Traditional IRA", brk: "Joint Brokerage" },
  incomes: [],
  accounts: [],
} as unknown as CellDrillContext;

function fixtureYear(): ProjectionYear {
  return {
    year: 2030,
    income: { socialSecurity: 30000 } as ProjectionYear["income"],
    taxDetail: {
      earnedIncome: 0,
      ordinaryIncome: 52000,
      dividends: 8200,
      capitalGains: 45000,
      stCapitalGains: 0,
      qbi: 0,
      taxExempt: 0,
      taxExemptInterest: 0,
      bySource: {
        "ira:rmd": { type: "ordinary_income", amount: 52000 },
        "brk:qdiv": { type: "dividends", amount: 8200 },
        "sale:t1": { type: "capital_gains", amount: 30000 }, // only 30k of the 45k LTCG is attributed
      },
    },
    deductionBreakdown: {
      aboveLine: { bySource: { c1: { label: "401(k) contribution", amount: 10000 } } },
      belowLine: { bySource: { c2: { label: "Charitable gift", amount: 5000 } } },
    } as unknown as ProjectionYear["deductionBreakdown"],
    taxResult: { income: { taxableSocialSecurity: 25500 } } as unknown as ProjectionYear["taxResult"],
  } as unknown as ProjectionYear;
}

describe("buildHouseholdSection", () => {
  it("emits rows for income, SS, and deductions", () => {
    const s = buildHouseholdSection(fixtureYear(), ctx, "Household");
    const types = s.rows.map((r) => r.type);
    expect(types).toContain("RMD");
    expect(types).toContain("Investment Income");
    expect(types).toContain("Social Security");
    expect(types).toContain("Above-Line Deduction");
    expect(types).toContain("Itemized / Deduction");
  });

  it("renders deductions as negative", () => {
    const s = buildHouseholdSection(fixtureYear(), ctx, "Household");
    const ded = s.rows.find((r) => r.type === "Above-Line Deduction")!;
    expect(ded.amount).toBe(-10000);
    expect(ded.character).toBe("deduction");
  });

  it("adds an Unattributed row when bySource undershoots the taxDetail bucket", () => {
    const s = buildHouseholdSection(fixtureYear(), ctx, "Household");
    const unattributed = s.rows.find((r) => r.type === "Unattributed" && r.character === "long_term_gain");
    expect(unattributed).toBeDefined();
    expect(unattributed!.amount).toBe(15000); // 45000 bucket − 30000 attributed
    expect(s.unreconciled).toBe(true);
  });

  it("keeps tax-free withdrawal rows out of the reconciled buckets", () => {
    const year = fixtureYear();
    year.taxDetail!.bySource["withdrawal_tax_free:ira"] = { type: "tax_free", amount: 20000 };
    const s = buildHouseholdSection(year, ctx, "Household");

    const row = s.rows.find((r) => r.type === "Withdrawal" && r.character === "non_taxable");
    expect(row).toMatchObject({ amount: 20000, taxable: false });
    // 20,000 tax-free draw + 4,500 non-taxable SS (split row).
    expect(s.characterSubtotals.non_taxable).toBe(24_500);
    // The non-taxable row must not create drift in any reconciled character —
    // the only Unattributed row is still the pre-existing LTCG gap.
    const unattributed = s.rows.filter((r) => r.type === "Unattributed");
    expect(unattributed).toHaveLength(1);
    expect(unattributed[0].character).toBe("long_term_gain");
  });

  it("renders a Roth/HSA education funding draw as a non-taxable Education Funding row (R4)", () => {
    const year = fixtureYear();
    year.taxDetail!.bySource["education_tax_free:edu"] = { type: "tax_free", amount: 15000 };
    const s = buildHouseholdSection(year, ctx, "Household");

    const row = s.rows.find((r) => r.type === "Education Funding");
    expect(row).toMatchObject({ character: "non_taxable", amount: 15000, taxable: false });
    // Non-taxable → not in the reconciled buckets, so no new Unattributed drift.
    const unattributed = s.rows.filter((r) => r.type === "Unattributed");
    expect(unattributed).toHaveLength(1);
    expect(unattributed[0].character).toBe("long_term_gain");
  });

  it("splits Social Security into taxable and non-taxable rows", () => {
    const s = buildHouseholdSection(fixtureYear(), ctx, "Household");
    const ssRows = s.rows.filter((r) => r.type === "Social Security");
    expect(ssRows).toHaveLength(2);
    const taxable = ssRows.find((r) => r.character === "social_security");
    const nonTaxable = ssRows.find((r) => r.character === "non_taxable");
    expect(taxable).toMatchObject({ amount: 25_500, taxable: true });
    expect(nonTaxable).toMatchObject({ amount: 4_500, taxable: false });
  });

  it("exposes taxable + gross subtotals that tie to the income report columns", () => {
    const s = buildHouseholdSection(fixtureYear(), ctx, "Household");
    // Taxable == report "Total Income": RMD 52,000 + qdiv 8,200 + LTCG bucket
    // 45,000 (30k attributed + 15k unattributed) + taxable SS 25,500.
    expect(s.taxableSubtotal).toBe(130_700);
    // Gross == report "Gross Total Income": adds the non-taxable SS remainder.
    expect(s.grossSubtotal).toBe(135_200);
  });

  it("sorts rows by descending magnitude", () => {
    const s = buildHouseholdSection(fixtureYear(), ctx, "Household");
    const mags = s.rows.map((r) => Math.abs(r.amount));
    expect(mags).toEqual([...mags].sort((a, b) => b - a));
  });

  it("computes character subtotals from the bucket totals", () => {
    const s = buildHouseholdSection(fixtureYear(), ctx, "Household");
    expect(s.characterSubtotals.long_term_gain).toBe(45000);
    expect(s.characterSubtotals.ordinary).toBe(52000);
  });
});
