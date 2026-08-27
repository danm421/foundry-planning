import { describe, it, expect } from "vitest";
import { initAnnuityState, stepAnnuityYear } from "../payout";
import type { AnnuityContract, AnnuityState } from "../types";

const rider = (over: Partial<AnnuityContract> = {}): AnnuityContract => ({
  productType: "fixed_indexed",
  taxTreatment: "non_qualified",
  costBasis: 100_000,
  annualFeePct: 0,
  incomeMode: "rider",
  incomeStartYear: 2030,
  rollupRatchets: false,
  rollupRate: 0,
  benefitBase: 100_000,
  payoutPct: 0.05,
  ...over,
});

const run = (
  contract: AnnuityContract,
  state: AnnuityState,
  year: number,
  ownerAge: number,
  growthRate = 0,
) => stepAnnuityYear({ contract, state, year, ownerAge, growthRate, isAlive: true });

describe("initAnnuityState", () => {
  it("seeds basis from costBasis when present", () => {
    const s = initAnnuityState(rider(), 250_000);
    expect(s.remainingBasis).toBe(100_000);
    expect(s.investmentInContract).toBe(100_000);
  });

  it("seeds basis to the account value when costBasis is unknown — no phantom gain", () => {
    const s = initAnnuityState(rider({ costBasis: undefined }), 250_000);
    expect(s.remainingBasis).toBe(250_000);
  });
});

describe("stepAnnuityYear — rider mode", () => {
  it("pays nothing before the income start year", () => {
    const s = initAnnuityState(rider(), 100_000);
    const r = run(rider(), s, 2029, 64);
    expect(r.income).toBe(0);
    expect(r.state.incomeActive).toBe(false);
  });

  it("never pays when incomeMode is none — the contract only accumulates", () => {
    const c = rider({ incomeMode: "none" });
    const r = run(c, initAnnuityState(c, 100_000), 2030, 65, 0.04);
    expect(r.income).toBe(0);
    expect(r.state.incomeActive).toBe(false);
    expect(r.state.accountValue).toBeCloseTo(104_000, 2);
  });

  it("never pays when the contract has no income start year", () => {
    const c = rider({ incomeStartYear: null });
    const r = run(c, initAnnuityState(c, 100_000), 2099, 90);
    expect(r.income).toBe(0);
    expect(r.state.incomeActive).toBe(false);
  });

  it("locks guaranteed income at benefitBase x payoutPct on activation", () => {
    const s = initAnnuityState(rider(), 100_000);
    const r = run(rider(), s, 2030, 65);
    expect(r.state.incomeActive).toBe(true);
    expect(r.state.guaranteedIncome).toBeCloseTo(5_000, 2);
    expect(r.income).toBeCloseTo(5_000, 2);
  });

  it("draws the account value down as it pays", () => {
    const s = initAnnuityState(rider(), 100_000);
    const r = run(rider(), s, 2030, 65);
    expect(r.state.accountValue).toBeCloseTo(95_000, 2);
  });

  it("THE CROSSOVER: keeps paying the guaranteed amount after the account value hits zero", () => {
    const c = rider();
    let s = initAnnuityState(c, 100_000);
    let year = 2030;
    let age = 65;
    // 20 payments of 5k exhaust a 100k account value at 0% growth.
    for (let i = 0; i < 25; i++) {
      const r = run(c, s, year, age);
      s = r.state;
      // The income NEVER stops, in any year.
      expect(r.income).toBeCloseTo(5_000, 2);
      year++; age++;
    }
    // Both halves matter: the balance is gone AND the income continued.
    // A test asserting only the income would pass on a broken balance.
    expect(s.accountValue).toBe(0);
  });

  it("taxes rider income LIFO, not by exclusion ratio — it is a withdrawal", () => {
    // 150k value / 100k basis => 50k gain. The first 5k payment is all OI.
    const c = rider();
    const s = initAnnuityState(c, 150_000);
    const r = run(c, s, 2030, 65);
    expect(r.ordinaryIncome).toBeCloseTo(5_000, 2);
    expect(r.basisReturn).toBe(0);
  });

  it("once basis is exhausted every later rider payment is fully taxable", () => {
    const c = rider();
    let s = initAnnuityState(c, 100_000);
    let year = 2030, age = 65;
    for (let i = 0; i < 25; i++) {
      const r = run(c, s, year, age);
      s = r.state;
      year++; age++;
    }
    const r = run(c, s, year, age);
    expect(r.ordinaryIncome).toBeCloseTo(5_000, 2);
    expect(r.basisReturn).toBe(0);
  });

  it("charges the pre-59.5 penalty when income starts early", () => {
    const c = rider({ incomeStartYear: 2030 });
    const s = initAnnuityState(c, 150_000);
    const r = run(c, s, 2030, 55);
    expect(r.earlyWithdrawalPenalty).toBeCloseTo(500, 2);
  });
});

describe("stepAnnuityYear — annuitized mode", () => {
  const spia = (over: Partial<AnnuityContract> = {}): AnnuityContract => ({
    productType: "spia",
    taxTreatment: "non_qualified",
    costBasis: 100_000,
    annualFeePct: 0,
    incomeMode: "annuitized",
    incomeStartYear: 2030,
    payoutStructure: "period_certain",
    periodCertainYears: 20,
    annuitizedPayment: 10_000,
    rollupRatchets: false,
    ...over,
  });

  it("zeroes the account value in the annuitization year — the money is gone to the carrier", () => {
    const c = spia();
    const s = initAnnuityState(c, 100_000);
    const r = run(c, s, 2030, 65);
    expect(r.state.accountValue).toBe(0);
    expect(r.income).toBeCloseTo(10_000, 2);
  });

  it("splits payments by the exclusion ratio: 100k basis over a 200k expected return is 50/50", () => {
    const c = spia();
    const s = initAnnuityState(c, 100_000);
    const r = run(c, s, 2030, 65);
    expect(r.basisReturn).toBeCloseTo(5_000, 2);
    expect(r.ordinaryIncome).toBeCloseTo(5_000, 2);
  });

  it("§72(b)(2): after 20 payments recover the basis, payment 21 is 100% taxable", () => {
    // The term runs 25 years so the payment-21 assertion isolates the §72(b)(2)
    // exclusion cap, not the end of the term. `expectedReturnYears` pins the
    // expected-return multiple at 20 so the ratio stays 100k / (10k x 20) = 0.50
    // and 20 payments exclude exactly the whole 100k investment.
    const c = spia({ periodCertainYears: 25, expectedReturnYears: 20 });
    let s = initAnnuityState(c, 100_000);
    let year = 2030, age = 65;
    for (let i = 0; i < 20; i++) {
      const r = run(c, s, year, age);
      s = r.state;
      year++; age++;
    }
    const r = run(c, s, year, age);
    expect(r.basisReturn).toBe(0);
    expect(r.ordinaryIncome).toBeCloseTo(10_000, 2);
  });

  it("a period-certain payout stops on schedule", () => {
    const c = spia();
    let s = initAnnuityState(c, 100_000);
    let year = 2030, age = 65;
    for (let i = 0; i < 20; i++) {
      s = run(c, s, year, age).state;
      year++; age++;
    }
    expect(run(c, s, year, age).income).toBe(0);
  });

  it("a qualified annuitized contract is fully taxable — basis is ignored", () => {
    const c = spia({ taxTreatment: "qualified", costBasis: 100_000 });
    const s = initAnnuityState(c, 100_000);
    const r = run(c, s, 2030, 70);
    expect(r.ordinaryIncome).toBeCloseTo(10_000, 2);
    expect(r.basisReturn).toBe(0);
  });

  it("a qualified contract distributing before 59.5 takes the 10% penalty on the whole payment", () => {
    const c = spia({ taxTreatment: "qualified" });
    const s = initAnnuityState(c, 100_000);
    const r = run(c, s, 2030, 55);
    expect(r.ordinaryIncome).toBeCloseTo(10_000, 2);
    expect(r.earlyWithdrawalPenalty).toBeCloseTo(1_000, 2);
  });

  it("a tax_free contract pays no tax at any age", () => {
    const c = spia({ taxTreatment: "tax_free" });
    const s = initAnnuityState(c, 100_000);
    const r = run(c, s, 2030, 50);
    expect(r.ordinaryIncome).toBe(0);
    expect(r.basisReturn).toBeCloseTo(10_000, 2);
    expect(r.earlyWithdrawalPenalty).toBe(0);
  });
});

describe("stepAnnuityYear — accumulation", () => {
  it("grows the account value net of the annual fee", () => {
    const c = rider({ incomeStartYear: 2040, annualFeePct: 0.01 });
    const s = initAnnuityState(c, 100_000);
    const r = run(c, s, 2030, 55, 0.06);
    expect(r.state.accountValue).toBeCloseTo(105_000, 2);
  });

  it("deducts the rider fee off the benefit base, from the account value", () => {
    const c = rider({ incomeStartYear: 2040, riderFeePct: 0.01, benefitBase: 200_000 });
    const s = initAnnuityState(c, 100_000);
    const r = run(c, s, 2030, 55, 0);
    // 1% of the 200k base = 2k, charged against the 100k account value.
    expect(r.state.accountValue).toBeCloseTo(98_000, 2);
  });
});

describe("stepAnnuityYear — death", () => {
  it("single_life income stops when the annuitant dies", () => {
    const c = rider({ payoutStructure: "single_life" });
    let s = initAnnuityState(c, 100_000);
    s = run(c, s, 2030, 65).state;
    const r = stepAnnuityYear({ contract: c, state: s, year: 2031, ownerAge: 66, growthRate: 0, isAlive: false });
    expect(r.income).toBe(0);
  });

  it("joint_survivor income continues at survivorPct", () => {
    const c = rider({ payoutStructure: "joint_survivor", survivorPct: 0.5 });
    let s = initAnnuityState(c, 100_000);
    s = run(c, s, 2030, 65).state;
    const r = stepAnnuityYear({ contract: c, state: s, year: 2031, ownerAge: 66, growthRate: 0, isAlive: false });
    expect(r.income).toBeCloseTo(2_500, 2);
  });
});
