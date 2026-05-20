import { describe, it, expect } from "vitest";
import { amortizeNote } from "../note-amortization";

describe("amortizeNote", () => {
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
