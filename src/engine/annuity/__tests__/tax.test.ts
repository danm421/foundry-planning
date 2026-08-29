import { describe, it, expect } from "vitest";
import {
  splitLifo,
  splitAnnuityDistribution,
  exclusionRatio,
  splitAnnuitized,
  earlyWithdrawalPenalty,
  expectedReturnMultiple,
} from "../tax";

describe("splitAnnuityDistribution — the three tax wrappers", () => {
  // Ledger #158: every existing qualified-arm test drew 100k against a 400k
  // gain, where LIFO ALSO returns 100% ordinary income — so the whole
  // `qualified` branch could be deleted and every test stayed green. These
  // draw PAST the gain, where the two rules finally disagree.
  it("a qualified draw past the gain is STILL all ordinary income", () => {
    const r = splitAnnuityDistribution({
      treatment: "qualified",
      amount: 450_000,
      accountValue: 600_000,
      remainingBasis: 200_000,
      ownerAge: 65,
    });
    expect(r.ordinaryIncome).toBe(450_000);
    expect(r.basisReturn).toBe(0);
  });

  it("...where a non-qualified draw of the same size returns basis", () => {
    // The contrast that gives the assertion above its teeth: same numbers,
    // different wrapper, 50k of the draw comes back tax-free under LIFO.
    const r = splitAnnuityDistribution({
      treatment: "non_qualified",
      amount: 450_000,
      accountValue: 600_000,
      remainingBasis: 200_000,
      ownerAge: 65,
    });
    expect(r.ordinaryIncome).toBe(400_000);
    expect(r.basisReturn).toBe(50_000);
  });

  it("a tax-free draw is all basis, never penalized", () => {
    const r = splitAnnuityDistribution({
      treatment: "tax_free",
      amount: 450_000,
      accountValue: 600_000,
      remainingBasis: 200_000,
      ownerAge: 50,
    });
    expect(r.ordinaryIncome).toBe(0);
    expect(r.basisReturn).toBe(450_000);
    expect(r.earlyWithdrawalPenalty).toBe(0);
  });

  it("an unknown basis means basis EQUALS the account value — no invented gain", () => {
    const r = splitAnnuityDistribution({
      treatment: "non_qualified",
      amount: 50_000,
      accountValue: 300_000,
      ownerAge: 65,
    });
    expect(r.ordinaryIncome).toBe(0);
    expect(r.basisReturn).toBe(50_000);
  });

  it("the qualified penalty falls on the whole draw pre-59.5", () => {
    const r = splitAnnuityDistribution({
      treatment: "qualified",
      amount: 100_000,
      accountValue: 600_000,
      remainingBasis: 200_000,
      ownerAge: 50,
    });
    expect(r.earlyWithdrawalPenalty).toBeCloseTo(10_000, 6);
  });
});

describe("exclusionRatio — the §72(b) cap at 1.0", () => {
  it("never exceeds 1, so a payment can never be MORE than fully excluded", () => {
    // $200k premium against 15 years of $10k payments is a 1.333 raw ratio.
    // Uncapped, splitAnnuitized returns 10,000 - 13,333 = -$3,333 of ordinary
    // income — a phantom deduction of ~$50k over the term. The Math.min is the
    // only thing preventing it and nothing watched it.
    expect(exclusionRatio(200_000, 150_000)).toBe(1);
  });

  it("a negative ordinary income is therefore impossible", () => {
    const r = splitAnnuitized({
      payment: 10_000,
      exclusionRatio: exclusionRatio(200_000, 150_000),
      investmentInContract: 200_000,
      cumulativeExcluded: 0,
      ownerAge: 70,
    });
    expect(r.ordinaryIncome).toBe(0);
    expect(r.basisReturn).toBe(10_000);
  });
});

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

  it("a fractional age is floored, not fed to the table as NaN", () => {
    // The mortality table is indexed by integer age: lx[65.5] is undefined, so an
    // unfloored age yields NaN — and NaN slips BOTH Math.max(1, NaN) here and
    // exclusionRatio's `expectedReturn <= 0` guard, silently NaN-ing the tax line.
    const m = expectedReturnMultiple({ structure: "single_life", ownerAge: 65.5 });
    expect(Number.isNaN(m)).toBe(false);
    expect(Number.isFinite(m)).toBe(true);
    expect(m).toBeGreaterThan(15);
    expect(m).toBeLessThan(30);

    // The co-annuitant age reaches the same table and needs the same flooring.
    const j = expectedReturnMultiple({ structure: "joint_survivor", ownerAge: 65.5, coAnnuitantAge: 62.5 });
    expect(Number.isNaN(j)).toBe(false);
    expect(Number.isFinite(j)).toBe(true);
    expect(j).toBeGreaterThan(m);
  });

  it("a period_certain with no term falls back to life expectancy, never to one year", () => {
    // periodCertainYears is nullable in AnnuityContract AND in the DB column. A
    // multiple of 1 pins exclusionRatio at 1.0, so a blank field would hand the
    // advisor a 100%-tax-free income stream until §72(b)(2) bites.
    const single = expectedReturnMultiple({ structure: "single_life", ownerAge: 65 });
    const nulled = expectedReturnMultiple({ structure: "period_certain", ownerAge: 65, periodCertainYears: null });
    const undef = expectedReturnMultiple({ structure: "period_certain", ownerAge: 65 });
    const zero = expectedReturnMultiple({ structure: "period_certain", ownerAge: 65, periodCertainYears: 0 });
    expect(nulled).toBe(single);
    expect(undef).toBe(single);
    expect(zero).toBe(single);
    // Cannot pass on the old `?? 1` behavior.
    expect(nulled).toBeGreaterThan(10);
    expect(undef).toBeGreaterThan(10);
    expect(zero).toBeGreaterThan(10);
  });
});

describe("earlyWithdrawalPenalty", () => {
  it("is 10% under 59.5 and zero at or after", () => {
    expect(earlyWithdrawalPenalty(10_000, 50)).toBe(1_000);
    expect(earlyWithdrawalPenalty(10_000, 59.5)).toBe(0);
    expect(earlyWithdrawalPenalty(10_000, 70)).toBe(0);
  });
});
