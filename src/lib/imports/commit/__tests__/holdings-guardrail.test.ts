import { describe, expect, it } from "vitest";
import { accountHoldingsGuardrail } from "../holdings-guardrail";

describe("accountHoldingsGuardrail", () => {
  it("preserves stated value when holdings materially undershoot", () => {
    const r = accountHoldingsGuardrail({
      value: 100_000,
      holdings: [{ ticker: "A", shares: 100, price: 200, marketValue: 20_000 }],
    });
    expect(r.deriveFromHoldings).toBe(false);
    expect(r.note).toContain("20,000");
    expect(r.note).toContain("100,000");
  });

  it("derives when holdings reconcile", () => {
    const r = accountHoldingsGuardrail({
      value: 20_000,
      holdings: [{ ticker: "A", shares: 100, price: 200, marketValue: 20_000 }],
    });
    expect(r.deriveFromHoldings).toBe(true);
    expect(r.note).toBeNull();
  });

  it("derives when there are no holdings", () => {
    const r = accountHoldingsGuardrail({ value: 100_000, holdings: [] });
    expect(r.deriveFromHoldings).toBe(true);
    expect(r.note).toBeNull();
  });

  it("does not flag overshoot (derives)", () => {
    const r = accountHoldingsGuardrail({
      value: 10_000,
      holdings: [{ ticker: "A", shares: 100, price: 200, marketValue: 20_000 }],
    });
    expect(r.deriveFromHoldings).toBe(true);
    expect(r.note).toBeNull();
  });

  it("derives on an immaterial (within-threshold) undershoot", () => {
    // $99,500 of $100,000 → 0.5% gap, under the 1% reconciliation threshold.
    const r = accountHoldingsGuardrail({
      value: 100_000,
      holdings: [{ ticker: "A", shares: 100, price: 995, marketValue: 99_500 }],
    });
    expect(r.deriveFromHoldings).toBe(true);
    expect(r.note).toBeNull();
  });

  it("derives when there is no stated value, even with holdings", () => {
    const r = accountHoldingsGuardrail({
      holdings: [{ ticker: "A", shares: 100, price: 200, marketValue: 20_000 }],
    });
    expect(r.deriveFromHoldings).toBe(true);
    expect(r.note).toBeNull();
  });

  it("undershoot detected from shares×price when marketValue is absent", () => {
    // No marketValue → holdingsReconciliation derives 100×200 = 20,000.
    const r = accountHoldingsGuardrail({
      value: 100_000,
      holdings: [{ ticker: "A", shares: 100, price: 200 }],
    });
    expect(r.deriveFromHoldings).toBe(false);
    expect(r.note).toContain("20,000");
  });
});
