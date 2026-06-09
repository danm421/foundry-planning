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
