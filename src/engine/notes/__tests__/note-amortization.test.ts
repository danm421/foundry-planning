import { describe, it, expect } from "vitest";
import { amortizeNote } from "../note-amortization";

describe("amortizeNote", () => {
  it("produces an interest-only-balloon schedule", () => {
    const schedule = amortizeNote({
      principal: 1_000_000,
      rate: 0.04,
      termMonths: 60,
      startYear: 2030,
      paymentType: "interest_only_balloon",
    });
    expect(schedule).toHaveLength(5);
    for (let i = 0; i < 4; i++) {
      expect(schedule[i].principal).toBe(0);
      expect(schedule[i].interest).toBeCloseTo(40_000, 1);
      expect(schedule[i].endingBalance).toBeCloseTo(1_000_000, 1);
    }
    expect(schedule[4].principal).toBeCloseTo(1_000_000, 1);
    expect(schedule[4].endingBalance).toBeCloseTo(0, 1);
  });

  it("handles zero rate", () => {
    const schedule = amortizeNote({
      principal: 60_000,
      rate: 0,
      termMonths: 60,
      startYear: 2026,
      paymentType: "amortizing",
    });
    expect(schedule).toHaveLength(5);
    expect(schedule[0].principal).toBeCloseTo(12_000, 1);
    expect(schedule[0].interest).toBe(0);
  });

  it("returns an empty schedule for zero principal or zero term", () => {
    expect(amortizeNote({
      principal: 0, rate: 0.05, termMonths: 60, startYear: 2026, paymentType: "amortizing",
    })).toEqual([]);
    expect(amortizeNote({
      principal: 100, rate: 0.05, termMonths: 0, startYear: 2026, paymentType: "amortizing",
    })).toEqual([]);
  });

  it("produces a level-payment amortization schedule (5% / 10yr / $100k)", () => {
    const schedule = amortizeNote({
      principal: 100_000,
      rate: 0.05,
      termMonths: 120,
      startYear: 2026,
      paymentType: "amortizing",
    });
    expect(schedule).toHaveLength(10);
    expect(schedule[0].year).toBe(2026);
    expect(schedule[9].year).toBe(2035);
    const annualPayment = schedule[0].interest + schedule[0].principal;
    expect(annualPayment).toBeCloseTo(12_727.86, 0);
    expect(schedule[9].endingBalance).toBeCloseTo(0, 0);
    const totalPrincipal = schedule.reduce((s, r) => s + r.principal, 0);
    expect(totalPrincipal).toBeCloseTo(100_000, 0);
  });
});
