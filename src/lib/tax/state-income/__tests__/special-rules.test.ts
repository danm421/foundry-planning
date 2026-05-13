// src/lib/tax/state-income/__tests__/special-rules.test.ts
import { describe, it, expect } from "vitest";
import { applyRecapture, RECAPTURE_RULES } from "../special-rules";

describe("applyRecapture — CA", () => {
  it("CA below recapture threshold → no adjustment", () => {
    const r = applyRecapture("CA", {
      stateTaxableIncome: 200_000,
      preCreditTax: 15_000,
      filingStatus: "joint",
    });
    expect(r.adjustment).toBe(0);
    expect(r.note).toContain("below threshold");
  });

  it("CA above 1M MJ → effective top-rate recapture", () => {
    const r = applyRecapture("CA", {
      stateTaxableIncome: 1_500_000,
      preCreditTax: 100_000,
      filingStatus: "joint",
    });
    expect(r.adjustment).toBeGreaterThan(0);
    // target = 1.5M × 0.133 = 199_500; adjustment = 199_500 − 100_000 = 99_500
    expect(r.adjustment).toBeCloseTo(99_500, 2);
  });

  it("CA single at $700K (below flat $1M threshold) → no adjustment", () => {
    // Real CA Mental Health Services Tax: flat $1M for ALL filing statuses.
    const r = applyRecapture("CA", {
      stateTaxableIncome: 700_000,
      preCreditTax: 50_000,
      filingStatus: "single",
    });
    expect(r.adjustment).toBe(0);
    expect(r.note).toContain("below threshold");
  });

  it("CA single at $1.5M → effective top-rate recapture (same $1M threshold as joint)", () => {
    const r = applyRecapture("CA", {
      stateTaxableIncome: 1_500_000,
      preCreditTax: 100_000,
      filingStatus: "single",
    });
    expect(r.adjustment).toBeGreaterThan(0);
    // target = 1.5M × 0.133 = 199_500; adjustment = 199_500 − 100_000 = 99_500
    expect(r.adjustment).toBeCloseTo(99_500, 2);
  });

  it("CA at exactly the threshold (joint) → no adjustment", () => {
    const r = applyRecapture("CA", {
      stateTaxableIncome: 1_000_000,
      preCreditTax: 90_000,
      filingStatus: "joint",
    });
    expect(r.adjustment).toBe(0);
  });
});

describe("applyRecapture — NY", () => {
  it("NY below $25M → no adjustment (Phase 1 simplification)", () => {
    const r = applyRecapture("NY", {
      stateTaxableIncome: 5_000_000,
      preCreditTax: 400_000,
      filingStatus: "joint",
    });
    expect(r.adjustment).toBe(0);
    expect(r.note).toContain("Phase 1");
  });

  it("NY above $25M → uses 10.9% top rate", () => {
    const r = applyRecapture("NY", {
      stateTaxableIncome: 30_000_000,
      preCreditTax: 2_000_000,
      filingStatus: "joint",
    });
    expect(r.adjustment).toBeGreaterThan(0);
    // target = 30M × 0.109 = 3.27M; adjustment = 3.27M − 2M = 1.27M
    expect(r.adjustment).toBeCloseTo(1_270_000, 2);
  });
});

describe("applyRecapture — CT", () => {
  it("CT below joint phase-out threshold ($200K) → no adjustment", () => {
    const r = applyRecapture("CT", {
      stateTaxableIncome: 150_000,
      preCreditTax: 7_000,
      filingStatus: "joint",
    });
    expect(r.adjustment).toBe(0);
  });

  it("CT at/above joint phase-out end ($340K) → full $600 benefit recaptured", () => {
    const r = applyRecapture("CT", {
      stateTaxableIncome: 340_000,
      preCreditTax: 20_000,
      filingStatus: "joint",
    });
    expect(r.adjustment).toBe(600);
  });

  it("CT joint phase-out end exceeded → still full $600 (clamped)", () => {
    const r = applyRecapture("CT", {
      stateTaxableIncome: 500_000,
      preCreditTax: 30_000,
      filingStatus: "joint",
    });
    expect(r.adjustment).toBe(600);
  });

  it("CT mid joint phase-out ($270K) → exactly half ($300)", () => {
    const r = applyRecapture("CT", {
      stateTaxableIncome: 270_000,
      preCreditTax: 15_000,
      filingStatus: "joint",
    });
    expect(r.adjustment).toBe(300);
  });

  it("CT single below phase-out start ($100,500) → no adjustment", () => {
    const r = applyRecapture("CT", {
      stateTaxableIncome: 80_000,
      preCreditTax: 3_500,
      filingStatus: "single",
    });
    expect(r.adjustment).toBe(0);
  });

  it("CT single at/above phase-out end ($200K) → full $300 benefit recaptured", () => {
    const r = applyRecapture("CT", {
      stateTaxableIncome: 200_000,
      preCreditTax: 12_000,
      filingStatus: "single",
    });
    expect(r.adjustment).toBe(300);
  });
});

describe("applyRecapture — states without rules", () => {
  it("TX (no rule) → adjustment is 0, note is empty", () => {
    const r = applyRecapture("TX", {
      stateTaxableIncome: 2_000_000,
      preCreditTax: 0,
      filingStatus: "joint",
    });
    expect(r.adjustment).toBe(0);
    expect(r.note).toBe("");
  });

  it("RECAPTURE_RULES is a partial map (TX absent)", () => {
    expect(RECAPTURE_RULES.TX).toBeUndefined();
    expect(RECAPTURE_RULES.CA).toBeDefined();
    expect(RECAPTURE_RULES.NY).toBeDefined();
    expect(RECAPTURE_RULES.CT).toBeDefined();
  });
});
