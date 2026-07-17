// src/lib/tax-ledger/parse-source.test.ts
import { describe, expect, it } from "vitest";
import type { CellDrillContext } from "@/lib/tax/cell-drill/types";
import { parseHouseholdSource } from "./parse-source";

const ctx = {
  accountNames: { acct1: "Traditional IRA", brk: "Joint Brokerage" },
  incomes: [{ id: "inc1", type: "salary", name: "Cooper Salary" }],
  accounts: [],
  entityNames: { ent1: "Business 1" },
  rothConversionNames: { rc1: "2030 Conversion" },
  noteNames: { n1: "Sale Note" },
  equityPlanNames: { eq1: "RSU Plan" },
} as unknown as CellDrillContext;

describe("parseHouseholdSource", () => {
  it("parses an RMD key", () => {
    const r = parseHouseholdSource("acct1:rmd", { type: "ordinary_income", amount: 52000 }, ctx);
    expect(r).toMatchObject({ type: "RMD", account: "Traditional IRA", character: "ordinary", amount: 52000, taxable: true });
  });
  it("parses portfolio qualified dividends", () => {
    const r = parseHouseholdSource("brk:qdiv", { type: "dividends", amount: 8200 }, ctx);
    expect(r).toMatchObject({ type: "Investment Income", account: "Joint Brokerage", character: "qualified_dividends" });
  });
  it("parses a 3-segment entity realization key (account resolves, entity segment ignored)", () => {
    const r = parseHouseholdSource("brk:stcg:ent1", { type: "stcg", amount: 100 }, ctx);
    expect(r).toMatchObject({ account: "Joint Brokerage", character: "short_term_gain" });
  });
  it("parses a Roth conversion with name", () => {
    const r = parseHouseholdSource("roth_conversion:rc1", { type: "ordinary_income", amount: 40000 }, ctx);
    expect(r).toMatchObject({ type: "Roth Conversion", description: "2030 Conversion", account: null });
  });
  it("parses business pass-through to a K-1 row", () => {
    const r = parseHouseholdSource("business_passthrough:ent1", { type: "qbi", amount: 1000 }, ctx);
    expect(r).toMatchObject({ type: "K-1 Pass-Thru Income", description: "Business 1 — K-1", character: "ordinary" });
  });
  it("parses an installment note interest key", () => {
    const r = parseHouseholdSource("note:n1:interest", { type: "ordinary_income", amount: 500 }, ctx);
    expect(r).toMatchObject({ type: "Installment Sale — Interest", description: "Sale Note" });
  });
  it("parses an installment note ltcg key", () => {
    const r = parseHouseholdSource("note:n1:ltcg", { type: "capital_gains", amount: 900 }, ctx);
    expect(r).toMatchObject({ type: "Installment Sale — Capital Gain", character: "long_term_gain" });
  });
  it("parses an asset sale", () => {
    const r = parseHouseholdSource("sale:txn9", { type: "capital_gains", amount: 45000 }, ctx);
    expect(r).toMatchObject({ type: "Asset Sale", character: "long_term_gain" });
  });
  it("parses a supplemental withdrawal", () => {
    const r = parseHouseholdSource("withdrawal:acct1", { type: "ordinary_income", amount: 10000 }, ctx);
    expect(r).toMatchObject({ type: "Withdrawal", account: "Traditional IRA" });
  });
  it("parses a tax-free withdrawal slice as a non-taxable row", () => {
    const r = parseHouseholdSource("withdrawal_tax_free:acct1", { type: "tax_free", amount: 289366 }, ctx);
    expect(r).toMatchObject({
      type: "Withdrawal",
      account: "Traditional IRA",
      character: "non_taxable",
      amount: 289366,
      taxable: false,
    });
  });
  it("parses an equity vest", () => {
    const r = parseHouseholdSource("equity-vest:eq1", { type: "earned_income", amount: 20000 }, ctx);
    expect(r).toMatchObject({ type: "Equity Vest/Exercise", description: "RSU Plan", character: "earned" });
  });
  it("parses a bare income-row id", () => {
    const r = parseHouseholdSource("inc1", { type: "earned_income", amount: 90000 }, ctx);
    expect(r).toMatchObject({ type: "Salary / Wages", description: "Cooper Salary", character: "earned" });
  });
  it("marks tax-exempt rows non-taxable", () => {
    const r = parseHouseholdSource("business_passthrough:ent1", { type: "tax_exempt", amount: 300 }, ctx);
    expect(r.taxable).toBe(false);
    expect(r.character).toBe("tax_exempt");
  });
});
