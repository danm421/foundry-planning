import { describe, it, expect } from "vitest";
import {
  charitableBunching, niitExposure, additionalMedicare, safeHarbor, capitalLossCarryover,
} from "../observations/money-flags";
import type { ObservationContext } from "../types";
import { params2025, retireeMfj, highEarnerMfj } from "./fixtures";

function ctxFor(facts: ReturnType<typeof retireeMfj>, prior: ReturnType<typeof retireeMfj> | null = null): ObservationContext {
  return { facts, prior, params: params2025, irmaaParams: params2025, primaryAge: 55, spouseAge: 54 };
}

describe("charitableBunching", () => {
  it("flags a standard-deduction filer who gives cash", () => {
    const f = retireeMfj();
    f.deductions.scheduleA = { saltPaid: null, saltDeducted: null, mortgageInterest: null, charitableCash: 6000, charitableNonCash: null, medical: null };
    const o = charitableBunching(ctxFor(f))!;
    expect(o.severity).toBe("opportunity");
    expect(o.body).toContain("bunch");
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
