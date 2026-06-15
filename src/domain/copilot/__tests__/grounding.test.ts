// src/domain/copilot/__tests__/grounding.test.ts
import { describe, it, expect } from "vitest";
import { findUngroundedNumbers } from "../grounding";

// Fixed mock plan: the exact JSON payloads run_projection + run_monte_carlo
// would return for this client/scenario.
const PROJECTION_PAYLOAD = JSON.stringify({
  scenarioId: "scn-1",
  taxGrounded: true,
  years: [
    { year: 2025, totalIncome: 100000, totalExpenses: 80000, netCashFlow: 20000, totalTax: 18000 },
    { year: 2026, totalIncome: 102000, totalExpenses: 81000, netCashFlow: 21000, totalTax: 18500 },
  ],
});
const MC_PAYLOAD = JSON.stringify({
  available: true,
  successRate: 0.92,
  endingDistribution: { p50: 2500000 },
});
const PAYLOADS = [PROJECTION_PAYLOAD, MC_PAYLOAD];

describe("grounding — anti-hallucination guard", () => {
  it("passes a faithful answer (every number traces to a payload)", () => {
    const answer =
      "In 2025 your income is $100,000 against $80,000 of expenses, leaving $20,000 of net " +
      "cash flow after $18,000 of tax. By 2026 income rises to $102,000. Your probability of " +
      "success is 92%, with a median ending portfolio around $2.5M.";
    expect(findUngroundedNumbers(answer, PAYLOADS)).toEqual([]);
  });

  it("flags a fabricated figure not present in any payload", () => {
    const answer =
      "Your plan funds a $250,000 annual lifestyle with a 97% probability of success.";
    const ungrounded = findUngroundedNumbers(answer, PAYLOADS);
    // 250000 and 97% are invented; neither appears in the payloads.
    expect(ungrounded).toContain("250,000");
    expect(ungrounded).toContain("97%");
  });

  it("treats year labels and plain integers as grounded when they appear in a payload", () => {
    const answer = "Across 2025 and 2026 your net cash flow stays above $20,000.";
    expect(findUngroundedNumbers(answer, PAYLOADS)).toEqual([]);
  });

  it("flags a fabricated percentage even when its integer appears as an unrelated payload value", () => {
    const payloads = [JSON.stringify({ fundCount: 12, successRate: 0.92 })];
    const ungrounded = findUngroundedNumbers("Your fees run about 12% a year.", payloads);
    expect(ungrounded).toContain("12%");
  });

  it("grounds a percentage whose decimal form is in the payload", () => {
    const payloads = [JSON.stringify({ successRate: 0.92 })];
    expect(findUngroundedNumbers("Probability of success is 92%.", payloads)).toEqual([]);
  });
});
