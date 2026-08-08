import { describe, it, expect } from "vitest";
import {
  marginalRateFor, taxOn, seTaxOn, totalScheduleCProfit, selfEmploymentEarnings,
} from "../findings/impact";
import {
  findingCtx, retireeMfj, scheduleCOwnerSingle, sCorpOwnerMfj,
} from "./fixtures";
import { emptyTaxReturnFacts, emptyBusiness } from "@/lib/schemas/tax-return-facts";

describe("marginalRateFor / taxOn", () => {
  it("returns null rather than 0 when the return has no filing status", () => {
    const ctx = findingCtx(emptyTaxReturnFacts(2025));
    expect(marginalRateFor(ctx)).toBeNull();
    expect(taxOn(10000, ctx)).toBeNull();
  });
  it("prices an amount at the return's marginal rate", () => {
    const ctx = findingCtx(retireeMfj(), { primaryAge: 72, spouseAge: 72 });
    const rate = marginalRateFor(ctx)!;
    expect(taxOn(10000, ctx)).toBeCloseTo(10000 * rate, 6);
  });
});

describe("seTaxOn", () => {
  it("matches the Schedule SE arithmetic for a sole Schedule C", () => {
    const ctx = findingCtx(scheduleCOwnerSingle(), { primaryAge: 44 });
    // 145,000 × 0.9235 = 133,907.50 → 16,604.53 SS + 3,883.32 Medicare
    expect(seTaxOn(145000, ctx)).toBeCloseTo(20487.85, 2);
  });
  it("coordinates the SS wage base against W-2 wages already taxed", () => {
    const ctx = findingCtx(sCorpOwnerMfj(), { primaryAge: 51, spouseAge: 49 });
    // 120,000 of wages leaves 56,100 of SS cap; 55,410 fits under it.
    expect(seTaxOn(60000, ctx)).toBeCloseTo(8477.73, 2);
  });
  it("caps the SS portion when W-2 wages already consume most of the wage base", () => {
    // Local copy — sCorpOwnerMfj() itself stays untouched; nine builders in
    // Tasks 7-10 depend on its AGI/taxable-income/additional-Medicare figures.
    const facts = sCorpOwnerMfj();
    facts.income.wages = 150000;
    const ctx = findingCtx(facts, { primaryAge: 51, spouseAge: 49 });
    // 150,000 of wages leaves only 26,100 of SS cap, below the 55,410 SE base:
    // SS 26,100 × 0.124 = 3,236.40; Medicare 55,410 × 0.029 = 1,606.89.
    expect(seTaxOn(60000, ctx)).toBeCloseTo(4843.29, 2);
  });
});

describe("totalScheduleCProfit / selfEmploymentEarnings", () => {
  it("sums businesses[] when present", () => {
    const facts = scheduleCOwnerSingle();
    facts.businesses.push({ ...emptyBusiness(), name: "Birch Studio", netProfit: -18000 });
    expect(totalScheduleCProfit(facts)).toBe(127000);
  });
  it("falls back to the Schedule 1 line 3 aggregate when businesses[] is empty", () => {
    const facts = emptyTaxReturnFacts(2025);
    facts.income.scheduleCNet = 64000;
    expect(totalScheduleCProfit(facts)).toBe(64000);
  });
  it("adds partnership guaranteed payments to the SE base", () => {
    // No Schedule C at all — the SE base is the 60,000 of guaranteed payments.
    expect(selfEmploymentEarnings(sCorpOwnerMfj())).toBe(60000);
  });
});
