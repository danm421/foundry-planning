import { describe, it, expect } from "vitest";
import { categorizeDraw } from "../withdrawal";
import { buildDefaultWithdrawalStrategy } from "../projection";
import { classifyTransferTax, type TransferTaxInput } from "../tax-classification";
import type { Account } from "../types";

const acct = (over: Partial<Account["annuity"]> = {}, value = 600_000): Account => ({
  id: "ann1",
  name: "Acme VA",
  category: "annuity",
  subType: "other",
  value,
  basis: 0,
  growthRate: 0.05,
  rmdEnabled: false,
  isDefaultChecking: false,
  owners: [],
  annuity: {
    productType: "variable",
    taxTreatment: "non_qualified",
    costBasis: 200_000,
    annualFeePct: 0,
    incomeMode: "none",
    rollupRatchets: false,
    ...over,
  },
} as unknown as Account);

const draw = (account: Account, amount: number, balance: number, ownerAge: number) =>
  categorizeDraw({ account, amount, balance, basisMap: {}, ownerAge });

describe("categorizeDraw — annuity", () => {
  it("no longer returns an untaxed zero — the pre-fix behavior", () => {
    const r = draw(acct(), 100_000, 600_000, 65);
    expect(r.ordinaryIncome).toBeGreaterThan(0);
  });

  it("is LIFO: a 100k draw on 600k value / 200k basis is 100% ordinary income", () => {
    const r = draw(acct(), 100_000, 600_000, 65);
    expect(r.ordinaryIncome).toBe(100_000);
    expect(r.basisReturn).toBe(0);
  });

  it("books ordinary income, NEVER capital gain", () => {
    const r = draw(acct(), 100_000, 600_000, 65);
    expect(r.capitalGains).toBe(0);
    // Without this second assertion the first one is vacuously true of the
    // pre-fix fall-through (which returned zeros for everything). Requiring the
    // whole draw to be characterized is what makes "never a capital gain" bite.
    expect(r.ordinaryIncome + r.basisReturn).toBe(100_000);
  });

  it("returns basis only after the gain is exhausted", () => {
    const r = draw(acct(), 450_000, 600_000, 65);
    expect(r.ordinaryIncome).toBe(400_000);
    expect(r.basisReturn).toBe(50_000);
  });

  it("charges §72(q) on the taxable slice only, under 59.5", () => {
    const r = draw(acct(), 450_000, 600_000, 50);
    expect(r.earlyWithdrawalPenalty).toBe(40_000);
  });

  it("a qualified annuity draw is fully taxable with a §72(t) penalty on the whole amount", () => {
    const r = draw(acct({ taxTreatment: "qualified" }), 100_000, 600_000, 50);
    expect(r.ordinaryIncome).toBe(100_000);
    expect(r.earlyWithdrawalPenalty).toBe(10_000);
  });

  it("a tax_free annuity draw is untaxed at any age", () => {
    const r = draw(acct({ taxTreatment: "tax_free" }), 100_000, 600_000, 40);
    expect(r.ordinaryIncome).toBe(0);
    expect(r.basisReturn).toBe(100_000);
    expect(r.earlyWithdrawalPenalty).toBe(0);
  });

  it("an annuity with no contract row falls back to basis = balance (no phantom gain)", () => {
    const bare = { ...acct(), annuity: undefined } as Account;
    const r = draw(bare, 100_000, 600_000, 65);
    expect(r.ordinaryIncome).toBe(0);
    expect(r.basisReturn).toBe(100_000);
  });
});

describe("withdrawal priority — annuity", () => {
  const mk = (id: string, category: Account["category"], subType = "other", annuity?: Account["annuity"]) =>
    ({ id, name: id, category, subType, value: 100_000, basis: 0, growthRate: 0,
       rmdEnabled: false, isDefaultChecking: false, owners: [], annuity } as unknown as Account);

  it("ranks a deferred annuity AFTER Roth — it is the worst source to tap", () => {
    const accounts = [
      mk("roth", "retirement", "roth_ira"),
      mk("ann", "annuity", "other", { productType: "variable", taxTreatment: "non_qualified",
        annualFeePct: 0, incomeMode: "none", rollupRatchets: false }),
    ];
    const strategy = buildDefaultWithdrawalStrategy(accounts, {
      planStartYear: 2026, planEndYear: 2060,
    } as never);
    const roth = strategy.find((s) => s.accountId === "roth")!;
    const ann = strategy.find((s) => s.accountId === "ann")!;
    expect(ann.priorityOrder).toBeGreaterThan(roth.priorityOrder);
  });

  it("REGRESSION GUARD: a deferred annuity is spendable at all", () => {
    // Before this feature `categoryWithdrawalPriority` returned null for every
    // annuity, so the strategy walk skipped it and the balance was dead money.
    const accounts = [mk("ann", "annuity", "other", { productType: "variable",
      taxTreatment: "non_qualified", annualFeePct: 0, incomeMode: "none", rollupRatchets: false })];
    const strategy = buildDefaultWithdrawalStrategy(accounts, {
      planStartYear: 2026, planEndYear: 2060,
    } as never);
    expect(strategy.some((s) => s.accountId === "ann")).toBe(true);
  });

  it("an ANNUITIZED contract is not spendable — the money is with the carrier", () => {
    const accounts = [mk("ann", "annuity", "other", { productType: "spia",
      taxTreatment: "non_qualified", annualFeePct: 0, incomeMode: "annuitized",
      annuitizedPayment: 10_000, rollupRatchets: false })];
    const strategy = buildDefaultWithdrawalStrategy(accounts, {
      planStartYear: 2026, planEndYear: 2060,
    } as never);
    expect(strategy.some((s) => s.accountId === "ann")).toBe(false);
  });
});

describe("classifyTransferTax — annuity source", () => {
  // An advisor-scheduled transfer OUT of an annuity is a §72 distribution, not
  // a brokerage liquidation. Before this branch existed it fell through to the
  // lot-ordered path and came out as a CAPITAL GAIN with no penalty.
  const transfer = (over: Partial<TransferTaxInput> = {}) =>
    classifyTransferTax({
      sourceCategory: "annuity",
      sourceSubType: "other",
      targetCategory: "cash",
      targetSubType: "checking",
      amount: 100_000,
      sourceAccountValue: 600_000,
      sourceAccountBasis: 0,
      allTraditionalIraBasis: 0,
      allTraditionalIraBalance: 0,
      ownerAge: 65,
      rothBasis: 0,
      sourceAnnuityTreatment: "non_qualified",
      sourceAnnuityBasis: 200_000,
      ...over,
    });

  it("is LIFO and ORDINARY — not a capital gain", () => {
    const r = transfer();
    expect(r.taxableOrdinaryIncome).toBe(100_000);
    expect(r.capitalGain).toBe(0);
    expect(r.basisReturn).toBe(0);
    expect(r.label).toBe("taxable_distribution");
  });

  it("returns basis once the gain is exhausted", () => {
    const r = transfer({ amount: 450_000 });
    expect(r.taxableOrdinaryIncome).toBe(400_000);
    expect(r.basisReturn).toBe(50_000);
  });

  it("charges §72(q) on the taxable slice only and labels it early", () => {
    const r = transfer({ amount: 450_000, ownerAge: 50 });
    expect(r.earlyWithdrawalPenalty).toBe(40_000);
    expect(r.label).toBe("early_distribution");
  });

  it("a qualified contract is fully taxable with the penalty on the whole amount", () => {
    const r = transfer({ sourceAnnuityTreatment: "qualified", ownerAge: 50 });
    expect(r.taxableOrdinaryIncome).toBe(100_000);
    expect(r.earlyWithdrawalPenalty).toBe(10_000);
    expect(r.capitalGain).toBe(0);
  });

  it("a tax_free contract is untaxed at any age", () => {
    const r = transfer({ sourceAnnuityTreatment: "tax_free", ownerAge: 40 });
    expect(r.taxableOrdinaryIncome).toBe(0);
    expect(r.basisReturn).toBe(100_000);
    expect(r.earlyWithdrawalPenalty).toBe(0);
  });

  it("an unknown basis means basis = value, so no phantom gain is invented", () => {
    const r = transfer({ sourceAnnuityBasis: undefined });
    expect(r.taxableOrdinaryIncome).toBe(0);
    expect(r.basisReturn).toBe(100_000);
    expect(r.capitalGain).toBe(0);
  });
});
