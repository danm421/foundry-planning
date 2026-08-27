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

/** The same step with the annuitant dead. */
const runDead = (
  contract: AnnuityContract,
  state: AnnuityState,
  year: number,
  ownerAge: number,
) => stepAnnuityYear({ contract, state, year, ownerAge, growthRate: 0, isAlive: false });

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

describe("stepAnnuityYear — rate guards", () => {
  it("rejects a NaN annualFeePct rather than poisoning every tax figure", () => {
    // Unguarded this returned real income of 5,000 alongside NaN for
    // ordinaryIncome, basisReturn AND accountValue, without throwing.
    const c = rider({ annualFeePct: Number.NaN });
    expect(() => run(c, initAnnuityState(c, 100_000), 2030, 65)).toThrow(
      "annualFeePct out of [0,1]: NaN",
    );
  });

  it("rejects a percent-style annualFeePct where a fraction belongs", () => {
    // `5` meaning 5% zeroed the account in a single year AND booked the whole
    // payment as tax-free basis — it inverted the taxable answer silently.
    const c = rider({ annualFeePct: 5 });
    expect(() => run(c, initAnnuityState(c, 100_000), 2030, 65)).toThrow(
      "annualFeePct out of [0,1]: 5",
    );
  });

  it("rejects an out-of-range riderFeePct", () => {
    const c = rider({ riderFeePct: 5 });
    expect(() => run(c, initAnnuityState(c, 100_000), 2030, 65)).toThrow(
      "riderFeePct out of [0,1]: 5",
    );
  });

  it("rejects a NaN riderFeePct — which a truthiness check would have skipped", () => {
    const c = rider({ riderFeePct: Number.NaN });
    expect(() => run(c, initAnnuityState(c, 100_000), 2030, 65)).toThrow(
      "riderFeePct out of [0,1]: NaN",
    );
  });

  it("rejects a NaN growthRate", () => {
    const c = rider();
    expect(() =>
      run(c, initAnnuityState(c, 100_000), 2030, 65, Number.NaN),
    ).toThrow("growthRate is not a finite rate: NaN");
  });

  it("accepts a NEGATIVE growthRate — a down market is not bad data", () => {
    const c = rider({ incomeStartYear: 2040 });
    const r = run(c, initAnnuityState(c, 100_000), 2030, 55, -0.2);
    expect(r.state.accountValue).toBeCloseTo(80_000, 2);
  });
});

describe("stepAnnuityYear — a contract already in force", () => {
  it("activates in the contract's STATED start year, not the first projected year", () => {
    // A SPIA that began paying in 2025, first modeled in 2030.
    const c = spia({ incomeStartYear: 2025, payoutStructure: "single_life" });
    const r = run(c, initAnnuityState(c, 100_000), 2030, 70);
    expect(r.state.activationYear).toBe(2025);
  });

  it("prices its exclusion ratio off the age at activation, not today's age", () => {
    // single_life, so the ratio is driven by the MORTALITY table and the two
    // ages genuinely disagree. Under period_certain the term fixes the ratio
    // and this assertion would pass under either reading — worthless.
    const inForce = spia({ incomeStartYear: 2025, payoutStructure: "single_life" });
    const fresh = spia({ incomeStartYear: 2030, payoutStructure: "single_life" });

    // Both step the SAME calendar year; the in-force contract activated at 65.
    const actual = run(inForce, initAnnuityState(inForce, 100_000), 2030, 70);
    const activatedAt65 = run(fresh, initAnnuityState(fresh, 100_000), 2030, 65);
    const activatedAt70 = run(fresh, initAnnuityState(fresh, 100_000), 2030, 70);

    expect(actual.state.lockedExclusionRatio).toBeCloseTo(
      activatedAt65.state.lockedExclusionRatio,
      10,
    );
    // And it is NOT what restarting the clock produced: a 70-year-old's shorter
    // life expectancy gives a HIGHER ratio, understating late-life taxable
    // income. Pin the gap so the two readings can never coincide.
    expect(activatedAt70.state.lockedExclusionRatio).toBeGreaterThan(
      actual.state.lockedExclusionRatio + 0.05,
    );
  });

  it("counts a period-certain term from the stated start, so an old term has fewer years left", () => {
    // A 20-year certain term that began in 2025 owes its last payment in 2044.
    const c = spia({ incomeStartYear: 2025 });
    let s = initAnnuityState(c, 100_000);
    s = run(c, s, 2030, 70).state;
    expect(run(c, s, 2044, 84).income).toBeCloseTo(10_000, 2);
    expect(run(c, s, 2045, 85).income).toBe(0);
  });
});

describe("stepAnnuityYear — a certain term is not life-contingent", () => {
  it("a 20-year certain SPIA pays on through the term after the owner dies, then stops", () => {
    const c = spia();
    let s = initAnnuityState(c, 100_000);
    s = run(c, s, 2030, 65).state; // year 1 of the term, alive

    // The owner dies. Every remaining certain payment is still owed.
    let year = 2031, age = 66;
    for (let i = 0; i < 19; i++) {
      const r = runDead(c, s, year, age);
      expect(r.income).toBeCloseTo(10_000, 2);
      s = r.state;
      year++; age++;
    }
    // 2049 was the 20th and final certain payment; 2050 owes nothing.
    expect(year).toBe(2050);
    expect(runDead(c, s, year, age).income).toBe(0);
  });

  it("life_with_period_certain pays through the certain term after death, then stops", () => {
    const c = spia({ payoutStructure: "life_with_period_certain", periodCertainYears: 10 });
    let s = initAnnuityState(c, 100_000);
    s = run(c, s, 2030, 65).state;
    // Inside the 10-year certain term the beneficiary is still owed the payment.
    expect(runDead(c, s, 2035, 70).income).toBeCloseTo(10_000, 2);
    // Past it the lifetime half died with the annuitant.
    expect(runDead(c, s, 2040, 75).income).toBe(0);
  });

  it("charges no early-withdrawal penalty on a certain payment made after death", () => {
    const c = spia();
    const s = initAnnuityState(c, 100_000);
    // Alive at 50, this payment carries the 10% §72(q) penalty on its taxable half.
    const alive = run(c, s, 2030, 50);
    expect(alive.earlyWithdrawalPenalty).toBeCloseTo(500, 2);
    // Dead: the term still pays in full, but death waives the penalty.
    const after = runDead(c, alive.state, 2031, 51);
    expect(after.income).toBeCloseTo(10_000, 2);
    expect(after.ordinaryIncome).toBeCloseTo(5_000, 2);
    expect(after.earlyWithdrawalPenalty).toBe(0);
  });
});
