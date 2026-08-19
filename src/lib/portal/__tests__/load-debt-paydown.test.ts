import { describe, it, expect } from "vitest";
import { toPaydownOption } from "@/lib/portal/load-debt-paydown";
import type { PortalDebtRow } from "@/lib/portal/contracts";

// Built from the verbatim PortalDebtRow interface (contracts.ts) — every field
// present, `rawBalance` defaulted to the same value as `balance` so the
// household share works out to 1 unless a test overrides one of them.
function row(over: Partial<PortalDebtRow>): PortalDebtRow {
  return {
    id: "l1",
    name: "Debt",
    balance: 10_000,
    rawBalance: 10_000,
    liabilityType: "auto",
    aprPercentage: null,
    statementBalance: null,
    minimumPayment: null,
    nextPaymentDueDate: null,
    interestRate: null,
    monthlyPayment: null,
    payoffYear: null,
    isPlaidLinked: false,
    ownerFmIds: [],
    ownerEntityIds: [],
    ...over,
  };
}

describe("toPaydownOption", () => {
  it("uses the client's own terms when they exist", () => {
    const o = toPaydownOption(row({ interestRate: 0.059, monthlyPayment: 415 }));
    expect(o.annualRate).toBe(0.059);
    expect(o.minimumPayment).toBe(415);
    expect(o.rateFromApr).toBe(false);
  });

  // interest_rate is NOT NULL DEFAULT '0' and is cleared alongside the
  // payment, so a stored 0 with no payment means "unset", not "0% loan".
  it("does not read the column's 0 default as a 0% loan", () => {
    const o = toPaydownOption(row({ interestRate: 0, monthlyPayment: null }));
    expect(o.annualRate).toBeNull();
    expect(o.minimumPayment).toBeNull();
  });

  it("keeps a genuine 0% loan at 0 when a payment stands beside it", () => {
    const o = toPaydownOption(row({ interestRate: 0, monthlyPayment: 100 }));
    expect(o.annualRate).toBe(0);
    expect(o.minimumPayment).toBe(100);
  });

  it("falls back to the Plaid APR and minimum for a card", () => {
    const o = toPaydownOption(
      row({ liabilityType: "credit_card", aprPercentage: 21.99, minimumPayment: 120 }),
    );
    // The APR arrives as a PERCENT and is divided by 100 exactly here.
    expect(o.annualRate).toBeCloseTo(0.2199, 6);
    expect(o.minimumPayment).toBe(120);
    expect(o.rateFromApr).toBe(true);
  });

  it("flags a debt we have no numbers for rather than dropping it", () => {
    const o = toPaydownOption(row({}));
    expect(o.annualRate).toBeNull();
    expect(o.minimumPayment).toBeNull();
    expect(o.name).toBe("Debt");
    expect(o.balance).toBe(10_000);
  });

  // PortalDebtRow.balance is already household-share-scaled (rawBalance * share),
  // but monthlyPayment is the full loan's payment. A $300k mortgage half-owned
  // by the household displays as a $150k balance; amortizing that against the
  // FULL $1,402 payment would overstate the payoff speed. The payment must be
  // scaled by the same share the balance already carries.
  it("scales a client-entered payment by the household's share of the balance", () => {
    const o = toPaydownOption(
      row({
        rawBalance: 300_000,
        balance: 150_000, // half-owned
        interestRate: 0.0649,
        monthlyPayment: 1_402,
      }),
    );
    expect(o.minimumPayment).toBe(701);
    // Rates are scale-free.
    expect(o.annualRate).toBe(0.0649);
  });

  it("scales the Plaid minimum payment by the household's share of the balance", () => {
    const o = toPaydownOption(
      row({
        rawBalance: 20_000,
        balance: 10_000, // half-owned
        liabilityType: "credit_card",
        aprPercentage: 21.99,
        minimumPayment: 120,
      }),
    );
    expect(o.minimumPayment).toBe(60);
    expect(o.annualRate).toBeCloseTo(0.2199, 6);
    expect(o.rateFromApr).toBe(true);
  });
});
