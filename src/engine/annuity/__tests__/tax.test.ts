import { describe, it, expect } from "vitest";
import {
  splitLifo,
  exclusionRatio,
  splitAnnuitized,
  earlyWithdrawalPenalty,
  expectedReturnMultiple,
} from "../tax";

describe("splitLifo — §72(e)(2)(B) gain-first ordering", () => {
  it("takes gain first: a $100k draw on a $600k/$200k-basis contract is all ordinary income", () => {
    const r = splitLifo({ withdrawal: 100_000, accountValue: 600_000, remainingBasis: 200_000, ownerAge: 65 });
    expect(r.ordinaryIncome).toBe(100_000);
    expect(r.basisReturn).toBe(0);
  });

  it("spills into basis only after the full gain is exhausted", () => {
    // gain = 600k - 200k = 400k. A 450k draw is 400k OI + 50k basis.
    const r = splitLifo({ withdrawal: 450_000, accountValue: 600_000, remainingBasis: 200_000, ownerAge: 65 });
    expect(r.ordinaryIncome).toBe(400_000);
    expect(r.basisReturn).toBe(50_000);
  });

  it("is NOT pro-rata — the mutation a brokerage-account instinct would produce", () => {
    // Pro-rata on 100k of a 600k/200k contract would be 66,667 OI + 33,333 basis.
    // Gain-first is 100k OI + 0 basis. This test exists to reject that mutation.
    const r = splitLifo({ withdrawal: 100_000, accountValue: 600_000, remainingBasis: 200_000, ownerAge: 65 });
    expect(r.basisReturn).not.toBeCloseTo(33_333, 0);
    expect(r.ordinaryIncome).not.toBeCloseTo(66_667, 0);
  });

  it("an underwater contract yields no gain and never a deductible loss", () => {
    const r = splitLifo({ withdrawal: 50_000, accountValue: 150_000, remainingBasis: 200_000, ownerAge: 65 });
    expect(r.ordinaryIncome).toBe(0);
    expect(r.basisReturn).toBe(50_000);
  });

  it("charges §72(q) on the taxable slice only, and only under 59.5", () => {
    const young = splitLifo({ withdrawal: 450_000, accountValue: 600_000, remainingBasis: 200_000, ownerAge: 50 });
    expect(young.earlyWithdrawalPenalty).toBe(40_000); // 10% of the 400k OI, not of 450k
    const old = splitLifo({ withdrawal: 450_000, accountValue: 600_000, remainingBasis: 200_000, ownerAge: 60 });
    expect(old.earlyWithdrawalPenalty).toBe(0);
  });
});

describe("exclusionRatio and splitAnnuitized — §72(b)", () => {
  it("is investment in contract over expected return", () => {
    expect(exclusionRatio(100_000, 200_000)).toBe(0.5);
  });

  it("splits each payment by the locked ratio", () => {
    const r = splitAnnuitized({
      payment: 10_000, exclusionRatio: 0.5, investmentInContract: 100_000,
      cumulativeExcluded: 0, ownerAge: 70,
    });
    expect(r.basisReturn).toBe(5_000);
    expect(r.ordinaryIncome).toBe(5_000);
  });

  it("§72(b)(2): once basis is fully recovered, every later payment is 100% taxable", () => {
    // 20 payments × 5k excluded = 100k = the whole investment. Payment 21:
    const r = splitAnnuitized({
      payment: 10_000, exclusionRatio: 0.5, investmentInContract: 100_000,
      cumulativeExcluded: 100_000, ownerAge: 90,
    });
    expect(r.basisReturn).toBe(0);
    expect(r.ordinaryIncome).toBe(10_000);
  });

  it("§72(b)(2): the payment that straddles the cap is split, not dropped", () => {
    const r = splitAnnuitized({
      payment: 10_000, exclusionRatio: 0.5, investmentInContract: 100_000,
      cumulativeExcluded: 97_000, ownerAge: 90,
    });
    expect(r.basisReturn).toBe(3_000);
    expect(r.ordinaryIncome).toBe(7_000);
  });
});

describe("expectedReturnMultiple", () => {
  it("uses the term for a period-certain payout", () => {
    expect(expectedReturnMultiple({ structure: "period_certain", ownerAge: 65, periodCertainYears: 20 })).toBe(20);
  });

  it("derives a life multiple from the mortality table for a 65-year-old", () => {
    const m = expectedReturnMultiple({ structure: "single_life", ownerAge: 65 });
    expect(m).toBeGreaterThan(15);
    expect(m).toBeLessThan(30);
  });

  it("a joint payout has a longer multiple than a single life at the same age", () => {
    const single = expectedReturnMultiple({ structure: "single_life", ownerAge: 65 });
    const joint = expectedReturnMultiple({ structure: "joint_survivor", ownerAge: 65, coAnnuitantAge: 65 });
    expect(joint).toBeGreaterThan(single);
  });
});

describe("earlyWithdrawalPenalty", () => {
  it("is 10% under 59.5 and zero at or after", () => {
    expect(earlyWithdrawalPenalty(10_000, 50)).toBe(1_000);
    expect(earlyWithdrawalPenalty(10_000, 59.5)).toBe(0);
    expect(earlyWithdrawalPenalty(10_000, 70)).toBe(0);
  });
});
