import { describe, it, expect } from "vitest";
import {
  charitableBunching, niitExposure, additionalMedicare, safeHarbor, capitalLossCarryover,
  ESTIMATED_UNDERPAYMENT_RATE,
} from "../findings/money-flags";
import { formatLineRefs } from "../findings/line-refs";
import { retireeMfj, highEarnerMfj, findingCtx } from "./fixtures";

const ctxFor = (facts: ReturnType<typeof retireeMfj>, prior: ReturnType<typeof retireeMfj> | null = null) =>
  findingCtx(facts, { primaryAge: 55, spouseAge: 54, prior });

describe("charitableBunching", () => {
  it("flags a standard-deduction filer who gives cash", () => {
    const f = retireeMfj();
    f.deductions.scheduleA = { saltPaid: null, saltDeducted: null, mortgageInterest: null, charitableCash: 6000, charitableNonCash: null, medical: null };
    const o = charitableBunching(ctxFor(f))!;
    expect(o.severity).toBe("opportunity");
    expect(o.whatToConsider).toContain("Bunching");
  });
  it("flags an itemizer barely above the standard deduction", () => {
    // highEarner: itemized 36000 vs std 30000 → gap 6000 < 20% of std
    const o = charitableBunching(ctxFor(highEarnerMfj()))!;
    expect(o.numbers.gapOverStandard).toBe(6000);
  });
  it("skips a non-giver on the standard deduction", () => {
    expect(charitableBunching(ctxFor(retireeMfj()))).toBeNull();
  });
});

describe("niitExposure", () => {
  it("computes exposed NII for a high earner over the threshold", () => {
    const o = niitExposure(ctxFor(highEarnerMfj()))!;
    expect(o.severity).toBe("watch");
    // NII = interest 3000 + ordDiv 9000 + LTCG 25000 = 37000; AGI excess = 217000
    expect(o.numbers.exposed).toBe(37000);
  });
  it("skips a filer under the threshold by a wide margin", () => {
    expect(niitExposure(ctxFor(retireeMfj()))).toBeNull();
  });
});

describe("additionalMedicare", () => {
  it("notes earned income over the threshold", () => {
    const o = additionalMedicare(ctxFor(highEarnerMfj()))!;
    expect(o.numbers.excess).toBe(180000);
  });
  it("skips low earners", () => {
    expect(additionalMedicare(ctxFor(retireeMfj()))).toBeNull();
  });
});

describe("safeHarbor", () => {
  it("warns when payments miss both safe harbors", () => {
    const f = retireeMfj(); // totalTax 21588, payments 19000 < 90% (19429)
    const o = safeHarbor(ctxFor(f))!;
    expect(o.severity).toBe("watch");
    expect(o.numbers.shortfall).toBeGreaterThan(0);
  });
  it("uses the prior-year 110% harbor when a prior return exists", () => {
    const prior = retireeMfj();
    prior.taxYear = 2024;
    prior.tax.totalTax = 17000; // 110% = 18700 ≤ payments 19000 → met
    const o = safeHarbor(ctxFor(retireeMfj(), prior));
    expect(o).toBeNull(); // met harbor, owed < 1000 → nothing to say
  });
});

describe("capitalLossCarryover", () => {
  it("reports an available carryover", () => {
    const f = retireeMfj();
    f.carryovers.capitalLossCarryover = 12000;
    const o = capitalLossCarryover(ctxFor(f))!;
    expect(o.numbers.carryover).toBe(12000);
  });
  it("skips when absent", () => {
    expect(capitalLossCarryover(ctxFor(retireeMfj()))).toBeNull();
  });
});

describe("money-flag findings — impact and category", () => {
  it("charitableBunching prices the wasted gift and files under deductions", () => {
    const facts = retireeMfj();
    facts.deductions.scheduleA = {
      saltPaid: 0, saltDeducted: 0, mortgageInterest: 0,
      charitableCash: 9000, charitableNonCash: 1000, medical: 0,
    };
    const f = charitableBunching(findingCtx(facts, { primaryAge: 72, spouseAge: 72 }))!;
    expect(f.category).toBe("deductions");
    expect(f.numbers.charitable).toBe(10000);
    expect(f.estimatedImpact).toBeCloseTo(10000 * f.numbers.marginalRate, 6);
    expect(f.whatToConsider).toContain("donor-advised fund");
  });

  it("charitableBunching carries NO figure in the barely-itemizing variant", () => {
    // highEarnerMfj itemizes 36,000 against a 30,000 standard — a 6,000 gap.
    const f = charitableBunching(findingCtx(highEarnerMfj(), { primaryAge: 45, spouseAge: 45 }))!;
    expect(f.numbers.gapOverStandard).toBe(6000);
    expect(f.estimatedImpact).toBeNull(); // the multi-year gain is not sourceable from one return
  });

  it("niitExposure prices the 3.8% and files under investments", () => {
    const f = niitExposure(findingCtx(highEarnerMfj(), { primaryAge: 45, spouseAge: 45 }))!;
    expect(f.category).toBe("investments");
    expect(f.estimatedImpact).toBe(f.numbers.estTax);
    expect(f.estimatedImpact).toBeCloseTo(37000 * 0.038, 6);
    expect(formatLineRefs(f.lineRefs)).toContain("Schedule 2 line 12");
  });

  it("additionalMedicare prices the 0.9% and files under withholding", () => {
    const f = additionalMedicare(findingCtx(highEarnerMfj(), { primaryAge: 45, spouseAge: 45 }))!;
    expect(f.category).toBe("withholding");
    expect(f.severity).toBe("info");
    expect(f.estimatedImpact).toBe(f.numbers.estTax);
    expect(f.estimatedImpact).toBeCloseTo(180000 * 0.009, 6);
  });

  it("safeHarbor prices the shortfall at the named underpayment rate", () => {
    // retireeMfj pays 19,000 against a 0.9 × 21,588 = 19,429.20 harbor.
    const f = safeHarbor(findingCtx(retireeMfj(), { primaryAge: 72, spouseAge: 72 }))!;
    expect(f.severity).toBe("watch");
    expect(f.numbers.shortfall).toBeCloseTo(429.2, 6);
    expect(f.estimatedImpact).toBeCloseTo(429.2 * ESTIMATED_UNDERPAYMENT_RATE, 6);
    expect(f.whyItMatters).toContain("illustrative");
  });

  it("safeHarbor's balance-due variant carries no figure — the harbor was met", () => {
    const facts = retireeMfj();
    facts.payments.withholding = 25000;
    facts.payments.amountOwed = 4200;
    const f = safeHarbor(findingCtx(facts, { primaryAge: 72, spouseAge: 72 }))!;
    expect(f.severity).toBe("info");
    expect(f.estimatedImpact).toBeNull();
  });

  it("capitalLossCarryover prices only the 3,000 usable against ordinary income", () => {
    const facts = retireeMfj();
    facts.carryovers.capitalLossCarryover = 18000;
    const f = capitalLossCarryover(findingCtx(facts, { primaryAge: 72, spouseAge: 72 }))!;
    expect(f.category).toBe("investments");
    expect(f.numbers.carryover).toBe(18000);
    // NOT 18,000 × rate: the rest only offsets gains that have not been realized.
    expect(f.estimatedImpact).toBeCloseTo(3000 * f.numbers.marginalRate, 6);
  });
});
