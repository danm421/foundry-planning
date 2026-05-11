// src/engine/__tests__/categorizeDraw.test.ts
import { describe, it, expect } from "vitest";
import { categorizeDraw } from "../withdrawal";
import type { Account } from "../types";

const baseAccount = (overrides: Partial<Account>): Account => ({
  id: "a1",
  name: "Test",
  category: "cash",
  subType: "checking",
  value: 100_000,
  basis: 100_000,
  growthRate: 0,
  rmdEnabled: false,
  owners: [],
  ...overrides,
});

describe("categorizeDraw", () => {
  it("cash → no recognized income, no penalty", () => {
    const acct = baseAccount({ category: "cash", subType: "savings" });
    const draw = categorizeDraw({ account: acct, amount: 10_000, balance: 100_000, basisMap: { a1: 10_000 }, ownerAge: 50 });
    // spec 2026-05-11: shape now includes basisReturn; cash draws return 100% basis
    expect(draw).toEqual({ accountId: "a1", amount: 10_000, ordinaryIncome: 0, capitalGains: 0, basisReturn: 10_000, earlyWithdrawalPenalty: 0 });
  });

  it("taxable: pro-rata gain → LTCG only on gain portion", () => {
    const acct = baseAccount({ id: "a2", category: "taxable", subType: "brokerage", value: 100_000, basis: 40_000 });
    // Pull $20k of $100k account with $40k basis → 60% gain ratio → $12k cap gain, $8k basis (no tax)
    const draw = categorizeDraw({ account: acct, amount: 20_000, balance: 100_000, basisMap: { a2: 40_000 }, ownerAge: 50 });
    expect(draw.amount).toBe(20_000);
    expect(draw.capitalGains).toBeCloseTo(12_000, 6);
    expect(draw.ordinaryIncome).toBe(0);
    expect(draw.earlyWithdrawalPenalty).toBe(0);
  });

  it("taxable: gain ratio uses live balance, not the stale Account.value snapshot", () => {
    // Account was created with value=100k (initial snapshot). After a few years
    // of LTCG-only growth the live balance has reached 150k while basis stayed
    // at 40k. Correct gain ratio is 1 − 40/150 = ~73.3%, not 1 − 40/100 = 60%.
    const acct = baseAccount({ id: "a-live", category: "taxable", subType: "brokerage", value: 100_000, basis: 40_000 });
    const draw = categorizeDraw({
      account: acct,
      amount: 30_000,
      balance: 150_000,
      basisMap: { "a-live": 40_000 },
      ownerAge: 65,
    });
    // 30_000 × (1 − 40/150) = 30_000 × 0.7333... = 22_000
    expect(draw.capitalGains).toBeCloseTo(22_000, 6);
  });

  it("taxable: zero-basis account → 100% LTCG", () => {
    const acct = baseAccount({ id: "a3", category: "taxable", subType: "brokerage", value: 100_000 });
    const draw = categorizeDraw({ account: acct, amount: 10_000, balance: 100_000, basisMap: { a3: 0 }, ownerAge: 50 });
    expect(draw.capitalGains).toBe(10_000);
    expect(draw.ordinaryIncome).toBe(0);
  });

  it("taxable: full-basis account → 0% LTCG", () => {
    const acct = baseAccount({ id: "a4", category: "taxable", subType: "brokerage", value: 100_000, basis: 100_000 });
    const draw = categorizeDraw({ account: acct, amount: 10_000, balance: 100_000, basisMap: { a4: 100_000 }, ownerAge: 50 });
    expect(draw.capitalGains).toBe(0);
  });

  it("taxable: zero-or-negative live balance → treat full draw as LTCG", () => {
    const acct = baseAccount({ id: "a-zero", category: "taxable", subType: "brokerage", value: 100_000, basis: 40_000 });
    const draw = categorizeDraw({ account: acct, amount: 5_000, balance: 0, basisMap: { "a-zero": 40_000 }, ownerAge: 65 });
    expect(draw.capitalGains).toBe(5_000);
  });

  it("traditional IRA, pre-59.5 → full ordinary + 10% penalty", () => {
    const acct = baseAccount({ id: "a5", category: "retirement", subType: "traditional_ira", value: 200_000 });
    const draw = categorizeDraw({ account: acct, amount: 10_000, balance: 200_000, basisMap: { a5: 0 }, ownerAge: 55 });
    expect(draw.ordinaryIncome).toBe(10_000);
    expect(draw.capitalGains).toBe(0);
    expect(draw.earlyWithdrawalPenalty).toBeCloseTo(1_000, 6);
  });

  it("traditional IRA, post-59.5 → full ordinary, no penalty", () => {
    const acct = baseAccount({ id: "a6", category: "retirement", subType: "traditional_ira", value: 200_000 });
    const draw = categorizeDraw({ account: acct, amount: 10_000, balance: 200_000, basisMap: { a6: 0 }, ownerAge: 65 });
    expect(draw.ordinaryIncome).toBe(10_000);
    expect(draw.earlyWithdrawalPenalty).toBe(0);
  });

  it("Roth IRA, basis-only draw, pre-59.5 → no income, no penalty (F2 ordering)", () => {
    const acct = baseAccount({ id: "a7", category: "retirement", subType: "roth_ira", value: 100_000 });
    // basis = 30k; pulling 20k stays in basis → tax-free
    const draw = categorizeDraw({ account: acct, amount: 20_000, balance: 100_000, basisMap: { a7: 30_000 }, ownerAge: 50 });
    expect(draw.ordinaryIncome).toBe(0);
    expect(draw.capitalGains).toBe(0);
    expect(draw.earlyWithdrawalPenalty).toBe(0);
  });

  it("Roth IRA, mixed basis + earnings, pre-59.5 → ordinary + 10% on earnings only", () => {
    const acct = baseAccount({ id: "a8", category: "retirement", subType: "roth_ira", value: 100_000 });
    // basis = 30k; pulling 50k → 30k basis (free) + 20k earnings (ord + 10% penalty)
    const draw = categorizeDraw({ account: acct, amount: 50_000, balance: 100_000, basisMap: { a8: 30_000 }, ownerAge: 50 });
    expect(draw.ordinaryIncome).toBe(20_000);
    expect(draw.earlyWithdrawalPenalty).toBeCloseTo(2_000, 6);
  });

  it("Roth IRA, earnings draw, post-59.5 → no tax, no penalty", () => {
    const acct = baseAccount({ id: "a9", category: "retirement", subType: "roth_ira", value: 100_000 });
    const draw = categorizeDraw({ account: acct, amount: 50_000, balance: 100_000, basisMap: { a9: 30_000 }, ownerAge: 65 });
    expect(draw.ordinaryIncome).toBe(0);
    expect(draw.earlyWithdrawalPenalty).toBe(0);
  });

  it("HSA → tax-free in v1 (qualified-medical assumption)", () => {
    const acct = baseAccount({ id: "a10", category: "retirement", subType: "hsa", value: 50_000 });
    const draw = categorizeDraw({ account: acct, amount: 10_000, balance: 50_000, basisMap: { a10: 0 }, ownerAge: 50 });
    expect(draw.ordinaryIncome).toBe(0);
    expect(draw.capitalGains).toBe(0);
    expect(draw.earlyWithdrawalPenalty).toBe(0);
  });
});

describe("categorizeDraw taxable — fresh-basis-first (spec 2026-05-11)", () => {
  const taxable = baseAccount({ id: "tx", category: "taxable", subType: "brokerage" });

  it("back-compat: freshBasisRemaining=0 (or undefined) matches pro-rata", () => {
    const draw = categorizeDraw({
      account: taxable, amount: 100, balance: 1000,
      basisMap: { tx: 400 }, ownerAge: 50,
    });
    // gainRatio = 1 - 400/1000 = 0.6
    expect(draw.capitalGains).toBeCloseTo(60, 2);
    expect(draw.basisReturn).toBeCloseTo(40, 2);
  });

  it("fully covered by fresh pool: 0 LTCG, 100% basisReturn", () => {
    const draw = categorizeDraw({
      account: taxable, amount: 50, balance: 1000,
      basisMap: { tx: 400 }, freshBasisRemaining: 100, ownerAge: 50,
    });
    expect(draw.capitalGains).toBe(0);
    expect(draw.basisReturn).toBe(50);
  });

  it("exactly equals fresh pool: 0 LTCG, all basisReturn", () => {
    const draw = categorizeDraw({
      account: taxable, amount: 100, balance: 1000,
      basisMap: { tx: 400 }, freshBasisRemaining: 100, ownerAge: 50,
    });
    expect(draw.capitalGains).toBe(0);
    expect(draw.basisReturn).toBe(100);
  });

  it("straddles fresh + legacy: legacy slice uses pre-fresh ratio", () => {
    // balance 1000, basis 400, freshBasisRemaining 100 → legacy 900/300
    // legacyGainRatio = 1 - 300/900 = 0.6667
    // amount 250: fresh 100 (0 LTCG), legacy 150 × 0.6667 = 100 LTCG
    const draw = categorizeDraw({
      account: taxable, amount: 250, balance: 1000,
      basisMap: { tx: 400 }, freshBasisRemaining: 100, ownerAge: 50,
    });
    expect(draw.capitalGains).toBeCloseTo(100, 2);
    expect(draw.basisReturn).toBeCloseTo(150, 2);
  });

  it("loss position: legacyBasis ≥ legacyValue clamps gain to 0", () => {
    // basis 1200 > balance 1000 (loss). freshBasisRemaining 50.
    // legacy: value 950, basis 1150 → gainRatio clamps to 0
    const draw = categorizeDraw({
      account: taxable, amount: 200, balance: 1000,
      basisMap: { tx: 1200 }, freshBasisRemaining: 50, ownerAge: 50,
    });
    expect(draw.capitalGains).toBe(0);
    expect(draw.basisReturn).toBe(200);
  });

  it("degenerate balance ≤ 0 falls back to all-gain", () => {
    const draw = categorizeDraw({
      account: taxable, amount: 100, balance: 0,
      basisMap: { tx: 0 }, freshBasisRemaining: 0, ownerAge: 50,
    });
    expect(draw.capitalGains).toBe(100);
    expect(draw.basisReturn).toBe(0);
  });

  it("screenshot fixture: $284,651 draw from $1,484,063/$1,013,607 with $38,630 fresh", () => {
    const draw = categorizeDraw({
      account: taxable, amount: 284_651, balance: 1_484_063,
      basisMap: { tx: 1_013_607 }, freshBasisRemaining: 38_630, ownerAge: 65,
    });
    // Expected per spec: realized LTCG ≈ $80,071, basisReturn ≈ $204,580
    expect(draw.capitalGains).toBeCloseTo(80_071, -1); // ±$10 tolerance
    expect(draw.basisReturn).toBeCloseTo(204_580, -1);
    expect(draw.capitalGains + draw.basisReturn).toBeCloseTo(284_651, 0);
  });
});
