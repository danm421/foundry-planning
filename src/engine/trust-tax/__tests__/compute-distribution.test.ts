import { describe, it, expect } from "vitest";
import { computeDistribution } from "../compute-distribution";

const ENTITY = "t1";
const POLICY_FIXED = {
  mode: "fixed" as const, amount: 50_000, percent: null,
  beneficiaryKind: "household" as const,
  beneficiaryFamilyMemberId: "fm1", beneficiaryExternalId: null,
};
const POLICY_PCT_INCOME = { ...POLICY_FIXED, mode: "pct_income" as const, amount: null, percent: 0.5 };
const POLICY_PCT_LIQUID = { ...POLICY_FIXED, mode: "pct_liquid" as const, amount: null, percent: 0.04 };

const INCOME = { ordinary: 60_000, dividends: 20_000, taxExempt: 10_000, recognizedCapGains: 0 };
const LIQUID = { cash: 200_000, taxableBrokerage: 300_000, retirementInRmdPhase: 0 };

describe("computeDistribution", () => {
  it("fixed mode distributes target from cash first when cash > target", () => {
    const r = computeDistribution({ entityId: ENTITY, policy: POLICY_FIXED, income: INCOME, liquid: LIQUID });
    expect(r.targetAmount).toBe(50_000);
    expect(r.actualAmount).toBe(50_000);
    expect(r.drawFromCash).toBe(50_000);
    expect(r.drawFromTaxable).toBe(0);
    expect(r.warnings).toHaveLength(0);
  });

  it("fixed mode cascades into taxable when cash is short", () => {
    const r = computeDistribution({
      entityId: ENTITY, policy: POLICY_FIXED, income: INCOME,
      liquid: { cash: 20_000, taxableBrokerage: 300_000, retirementInRmdPhase: 0 },
    });
    expect(r.drawFromCash).toBe(20_000);
    expect(r.drawFromTaxable).toBe(30_000);
    expect(r.actualAmount).toBe(50_000);
    expect(r.warnings).toHaveLength(0);
  });

  it("pct_income computes target from ordinary + divs + taxExempt only", () => {
    const r = computeDistribution({ entityId: ENTITY, policy: POLICY_PCT_INCOME, income: INCOME, liquid: LIQUID });
    expect(r.targetAmount).toBe(45_000);
  });

  it("pct_liquid includes retirement only when in RMD phase", () => {
    const r = computeDistribution({
      entityId: ENTITY, policy: POLICY_PCT_LIQUID, income: INCOME,
      liquid: { cash: 200_000, taxableBrokerage: 300_000, retirementInRmdPhase: 500_000 },
    });
    expect(r.targetAmount).toBe(40_000);
  });

  it("caps distribution at total liquid and emits warning when target > liquid", () => {
    const r = computeDistribution({
      entityId: ENTITY,
      policy: { ...POLICY_FIXED, amount: 1_000_000 },
      income: INCOME,
      liquid: { cash: 10_000, taxableBrokerage: 5_000, retirementInRmdPhase: 0 },
    });
    expect(r.actualAmount).toBe(15_000);
    expect(r.warnings).toContainEqual({
      code: "trust_distribution_insufficient_liquid",
      entityId: ENTITY,
      shortfall: 985_000,
    });
  });

  it("splits DNI pro-rata by income type (ordinary/divs/taxExempt)", () => {
    const r = computeDistribution({ entityId: ENTITY, policy: POLICY_FIXED, income: INCOME, liquid: LIQUID });
    expect(r.dniOrdinary).toBeCloseTo(50_000 * (60 / 90), 1);
    expect(r.dniDividends).toBeCloseTo(50_000 * (20 / 90), 1);
    expect(r.dniTaxExempt).toBeCloseTo(50_000 * (10 / 90), 1);
  });

  it("caps DNI at total income when distribution > income (corpus component zeroes DNI)", () => {
    const r = computeDistribution({
      entityId: ENTITY,
      policy: { ...POLICY_FIXED, amount: 120_000 },
      income: INCOME,
      liquid: LIQUID,
    });
    expect(r.actualAmount).toBe(120_000);
    expect(r.dniOrdinary + r.dniDividends + r.dniTaxExempt).toBeCloseTo(90_000, 1);
  });

  it("null policy → zero target, zero DNI, no funding draws", () => {
    const r = computeDistribution({
      entityId: ENTITY,
      policy: { ...POLICY_FIXED, mode: null, amount: null, percent: null },
      income: INCOME, liquid: LIQUID,
    });
    expect(r.targetAmount).toBe(0);
    expect(r.actualAmount).toBe(0);
    expect(r.dniOrdinary).toBe(0);
  });
});
