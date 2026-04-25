import { describe, it, expect } from "vitest";
import { applyTrustAnnualPass } from "../index";
import type { BracketTier } from "@/lib/tax/types";

const trustIncome2026: BracketTier[] = [
  { from: 0,     to: 3300,  rate: 0.10 },
  { from: 3300,  to: 12000, rate: 0.24 },
  { from: 12000, to: 16250, rate: 0.35 },
  { from: 16250, to: null,  rate: 0.37 },
];
const trustCapGains2026: BracketTier[] = [
  { from: 0,     to: 3350,  rate: 0    },
  { from: 3350,  to: 16300, rate: 0.15 },
  { from: 16300, to: null,  rate: 0.20 },
];

const SLAT = {
  entityId: "e1",
  isGrantorTrust: false,
  distributionPolicy: {
    mode: "pct_income" as const, amount: null, percent: 1.0,
    beneficiaryKind: "household" as const,
    beneficiaryFamilyMemberId: "fm-spouse", beneficiaryExternalId: null,
  },
  trustCashStart: 0,
};

describe("applyTrustAnnualPass", () => {
  it("full DNI carry-out to spouse → zero trust tax, full DNI to household", () => {
    const r = applyTrustAnnualPass({
      year: 2026,
      nonGrantorTrusts: [SLAT],
      yearRealizations: [
        { accountId: "a1", ownerEntityId: "e1", ordinary: 60_000, dividends: 20_000, taxExempt: 10_000, capGains: 5_000 },
      ],
      assetTransactionGains: [],
      trustLiquidity: new Map([["e1", { cash: 100_000, taxableBrokerage: 500_000, retirementInRmdPhase: 0 }]]),
      trustIncomeBrackets: trustIncome2026,
      trustCapGainsBrackets: trustCapGains2026,
      niitRate: 0.038,
      niitThreshold: 16_250,
      flatStateRate: 0,
      outOfHouseholdRate: 0.37,
    });
    expect(r.householdIncomeDelta.ordinary).toBeCloseTo(60_000, 0);
    expect(r.householdIncomeDelta.dividends).toBeCloseTo(20_000, 0);
    expect(r.householdIncomeDelta.taxExempt).toBeCloseTo(10_000, 0);
    expect(r.taxByEntity.get("e1")?.total).toBeCloseTo(0, 0);
  });

  it("full accumulation → all income retained and taxed at trust", () => {
    const r = applyTrustAnnualPass({
      year: 2026,
      nonGrantorTrusts: [{ ...SLAT, distributionPolicy: { ...SLAT.distributionPolicy, mode: null, percent: null, beneficiaryKind: null } }],
      yearRealizations: [
        { accountId: "a1", ownerEntityId: "e1", ordinary: 50_000, dividends: 0, taxExempt: 0, capGains: 0 },
      ],
      assetTransactionGains: [],
      trustLiquidity: new Map([["e1", { cash: 100_000, taxableBrokerage: 500_000, retirementInRmdPhase: 0 }]]),
      trustIncomeBrackets: trustIncome2026,
      trustCapGainsBrackets: trustCapGains2026,
      niitRate: 0.038,
      niitThreshold: 16_250,
      flatStateRate: 0,
      outOfHouseholdRate: 0.37,
    });
    expect(r.householdIncomeDelta.ordinary).toBe(0);
    const tax = r.taxByEntity.get("e1")!;
    expect(tax.retainedOrdinary).toBe(50_000);
    expect(tax.federalOrdinaryTax).toBeGreaterThan(16_000);
    expect(tax.niit).toBeGreaterThan(0);
  });

  it("asset-transaction sale → gain recognized at trust with compressed LTCG", () => {
    const r = applyTrustAnnualPass({
      year: 2026,
      nonGrantorTrusts: [{ ...SLAT, distributionPolicy: { ...SLAT.distributionPolicy, mode: null, percent: null, beneficiaryKind: null } }],
      yearRealizations: [],
      assetTransactionGains: [{ ownerEntityId: "e1", gain: 1_000_000 }],
      trustLiquidity: new Map([["e1", { cash: 1_000_000, taxableBrokerage: 0, retirementInRmdPhase: 0 }]]),
      trustIncomeBrackets: trustIncome2026,
      trustCapGainsBrackets: trustCapGains2026,
      niitRate: 0.038,
      niitThreshold: 16_250,
      flatStateRate: 0,
      outOfHouseholdRate: 0.37,
    });
    const tax = r.taxByEntity.get("e1")!;
    expect(tax.recognizedCapGains).toBe(1_000_000);
    // (16300-3350)*.15 + (1_000_000-16300)*.20 = 1942.5 + 196,740 = 198,682.5
    expect(tax.federalCapGainsTax).toBeCloseTo(198_682.5, 0);
  });

  it("propagates warnings from sub-modules", () => {
    const r = applyTrustAnnualPass({
      year: 2026,
      nonGrantorTrusts: [{ ...SLAT, distributionPolicy: { ...SLAT.distributionPolicy, mode: "fixed", amount: 1_000_000, percent: null } }],
      yearRealizations: [
        { accountId: "a1", ownerEntityId: "e1", ordinary: 10_000, dividends: 0, taxExempt: 0, capGains: 0 },
      ],
      assetTransactionGains: [],
      trustLiquidity: new Map([["e1", { cash: 5_000, taxableBrokerage: 10_000, retirementInRmdPhase: 0 }]]),
      trustIncomeBrackets: trustIncome2026,
      trustCapGainsBrackets: trustCapGains2026,
      niitRate: 0.038,
      niitThreshold: 16_250,
      flatStateRate: 0,
      outOfHouseholdRate: 0.37,
    });
    expect(r.warnings.some((w) => w.code === "trust_distribution_insufficient_liquid")).toBe(true);
  });
});
