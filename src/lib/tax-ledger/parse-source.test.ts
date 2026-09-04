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
  it("parses the education-funding capital-gain key without leaking the goal UUID", () => {
    // The generic <acctId>:<kind> fallback would render this as
    // account "education_capital" / description "<GOAL-UUID>".
    const r = parseHouseholdSource(
      "education_capital:3f1b0c2a-0000-4000-8000-000000000001",
      { type: "capital_gains", amount: -15000 },
      ctx,
    );
    expect(r).toMatchObject({
      type: "Education Funding",
      description: "Capital gain",
      character: "long_term_gain",
      account: null,
      amount: -15000,
      taxable: true,
    });
  });
  it("parses the education-funding taxable-distribution key without leaking the goal UUID", () => {
    const r = parseHouseholdSource(
      "education:3f1b0c2a-0000-4000-8000-000000000001",
      { type: "ordinary_income", amount: 5000 },
      ctx,
    );
    expect(r).toMatchObject({
      type: "Education Funding",
      description: "Taxable distribution",
      character: "ordinary",
      account: null,
      amount: 5000,
      taxable: true,
    });
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
  it("parses an annuity return-of-basis slice as a NON-TAXABLE row", () => {
    // The generic <acctId>:<kind> fallback rendered this as account
    // "annuity_tax_free" / description "<ACCOUNT-UUID>" — and, because the
    // engine's raw type fell through `rawTypeToCharacter`'s default, as
    // TAXABLE. A §72 return of basis is not income; taxable:false is the
    // load-bearing assertion here.
    const r = parseHouseholdSource(
      "annuity_tax_free:acct1",
      { type: "tax_free", amount: 10_000 },
      ctx,
    );
    expect(r).toMatchObject({
      type: "Annuity Income",
      description: "Return of basis (§72)",
      character: "non_taxable",
      account: "Traditional IRA",
      amount: 10_000,
      taxable: false,
    });
    expect(r.type).not.toBe("Investment Income");
  });
  it("parses an annuity taxable distribution without leaking the account UUID", () => {
    const r = parseHouseholdSource(
      "annuity:3f1b0c2a-0000-4000-8000-000000000001",
      { type: "ordinary_income", amount: 12_000 },
      ctx,
    );
    expect(r).toMatchObject({
      type: "Annuity Income",
      description: "Taxable distribution",
      character: "ordinary",
      amount: 12_000,
      taxable: true,
    });
    expect(r.description).not.toBe("3f1b0c2a-0000-4000-8000-000000000001");
    // A known account id resolves to its name rather than falling through.
    const known = parseHouseholdSource("annuity:acct1", { type: "ordinary_income", amount: 12_000 }, ctx);
    expect(known).toMatchObject({ account: "Traditional IRA", character: "ordinary", taxable: true });
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

  it("parses a tax_adjustment:<uuid> key without leaking the uuid or a wrong category", () => {
    // Without a dedicated arm this falls into the generic <acctId>:<kind>
    // fallback, which reads "tax_adjustment" as the account id (rendering the
    // wrong category, "Investment Income") and the uuid as the description —
    // leaking the raw id at the advisor.
    const uuid = "3f1b0c2a-0000-4000-8000-000000000099";
    const r = parseHouseholdSource(`tax_adjustment:${uuid}`, { type: "ordinary_income", amount: 120_000 }, ctx);
    expect(r).toMatchObject({
      type: "Tax Adjustment",
      description: "Income already received",
      character: "ordinary",
      account: null,
      amount: 120_000,
      taxable: true,
    });
    expect(r.type).not.toBe("Investment Income");
    expect(r.description).not.toBe(uuid);
  });
});
