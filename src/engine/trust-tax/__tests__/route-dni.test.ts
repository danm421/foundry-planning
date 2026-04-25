import { describe, it, expect } from "vitest";
import { routeDni } from "../route-dni";
import type { DistributionResult, DistributionPolicy } from "../types";

const DR: DistributionResult = {
  targetAmount: 50_000,
  actualAmount: 50_000,
  drawFromCash: 50_000,
  drawFromTaxable: 0,
  dniOrdinary: 30_000,
  dniDividends: 15_000,
  dniTaxExempt: 5_000,
  warnings: [],
};

const HOUSEHOLD: DistributionPolicy = {
  mode: "fixed", amount: 50_000, percent: null,
  beneficiaryKind: "household",
  beneficiaryFamilyMemberId: "fm-spouse", beneficiaryExternalId: null,
};

const NON_HOUSEHOLD: DistributionPolicy = { ...HOUSEHOLD, beneficiaryKind: "non_household" };

describe("routeDni", () => {
  it("adds household DNI to household income buckets", () => {
    const r = routeDni({ distributionResult: DR, policy: HOUSEHOLD, outOfHouseholdRate: 0.37 });
    expect(r.householdIncomeDelta).toEqual({ ordinary: 30_000, dividends: 15_000, taxExempt: 5_000 });
    expect(r.estimatedBeneficiaryTax).toBe(0);
  });

  it("applies flat rate to out-of-household DNI (ordinary + divs only; taxExempt is exempt)", () => {
    const r = routeDni({ distributionResult: DR, policy: NON_HOUSEHOLD, outOfHouseholdRate: 0.37 });
    expect(r.householdIncomeDelta).toEqual({ ordinary: 0, dividends: 0, taxExempt: 0 });
    // flat tax applies to taxable DNI only (ordinary + dividends), not tax-exempt
    expect(r.estimatedBeneficiaryTax).toBeCloseTo((30_000 + 15_000) * 0.37, 1);
  });

  it("null policy → no routing, zero everywhere", () => {
    const empty = { ...DR, actualAmount: 0, dniOrdinary: 0, dniDividends: 0, dniTaxExempt: 0 };
    const r = routeDni({
      distributionResult: empty,
      policy: { ...HOUSEHOLD, mode: null, beneficiaryKind: null },
      outOfHouseholdRate: 0.37,
    });
    expect(r.householdIncomeDelta).toEqual({ ordinary: 0, dividends: 0, taxExempt: 0 });
    expect(r.estimatedBeneficiaryTax).toBe(0);
  });
});
