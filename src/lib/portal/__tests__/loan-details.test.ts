import { describe, it, expect } from "vitest";
import {
  CLEARED_LOAN_COLUMNS,
  MAX_LOAN_TERM_MONTHS,
  payoffYear,
  resolveLoanDetails,
  supportsLoanDetails,
} from "@/lib/portal/loan-details";
import { calcPayment } from "@/lib/loan-math";
import { buildLiabilitySchedules } from "@/engine/liability-schedules";
import { isHeldFlatLiability } from "@/engine/liability-kind";
import type { Liability } from "@/engine/types";

describe("resolveLoanDetails", () => {
  it("derives the payoff term from the balance, rate and payment", () => {
    // A 5-year, 6% loan on $10,000 — the payment that clears it in exactly 60.
    const payment = calcPayment(10_000, 0.06, 60);
    const result = resolveLoanDetails(10_000, "auto", {
      interestRate: 0.06,
      monthlyPayment: payment.toFixed(2),
    });
    expect(result).toEqual({
      ok: true,
      columns: { interestRate: "0.0600", monthlyPayment: payment.toFixed(2), termMonths: 60, termUnit: "monthly" },
    });
  });

  it("accepts a 0% loan — promotional auto financing still amortizes", () => {
    const result = resolveLoanDetails(12_000, "auto", { interestRate: 0, monthlyPayment: "500" });
    expect(result).toEqual({
      ok: true,
      columns: { interestRate: "0.0000", monthlyPayment: "500.00", termMonths: 24, termUnit: "monthly" },
    });
  });

  it("clears the terms when the payment is missing, blank or zero", () => {
    for (const monthlyPayment of [undefined, null, "", "0", 0]) {
      expect(resolveLoanDetails(22_687.59, "auto", { interestRate: 0.0649, monthlyPayment })).toEqual({
        ok: true,
        columns: CLEARED_LOAN_COLUMNS,
      });
    }
  });

  it("rejects a payment that never covers the interest, naming both figures", () => {
    // $100k at 5% accrues ~$417/mo; $200 never touches principal.
    const result = resolveLoanDetails(100_000, "auto", { interestRate: 0.05, monthlyPayment: "200" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain("$200");
    expect(result.error).toContain("$417");
    expect(result.error).toContain("never be paid off");
  });

  it("rejects a rate sent as a percent instead of a fraction", () => {
    // 6.49 would be 649% — the ceiling is what catches the unit mistake.
    const result = resolveLoanDetails(22_687.59, "auto", { interestRate: 6.49, monthlyPayment: "512.43" });
    expect(result).toEqual({ ok: false, error: "Enter an interest rate between 0% and 100%." });
  });

  it("rejects a negative rate", () => {
    const result = resolveLoanDetails(10_000, "auto", { interestRate: -0.01, monthlyPayment: "500" });
    expect(result.ok).toBe(false);
  });

  it("rejects a non-numeric rate rather than silently reading it as 0%", () => {
    const result = resolveLoanDetails(10_000, "auto", { interestRate: "six", monthlyPayment: "500" });
    expect(result).toEqual({ ok: false, error: "Enter the interest rate as a number." });
  });

  it("treats an omitted rate as 0%", () => {
    const result = resolveLoanDetails(12_000, "auto", { monthlyPayment: "500" });
    expect(result).toEqual({
      ok: true,
      columns: { interestRate: "0.0000", monthlyPayment: "500.00", termMonths: 24, termUnit: "monthly" },
    });
  });

  it("rejects payment terms on a debt with no balance", () => {
    const result = resolveLoanDetails(0, "auto", { interestRate: 0.06, monthlyPayment: "500" });
    expect(result).toEqual({
      ok: false,
      error: "Enter this debt's balance before its payment terms.",
    });
  });

  it("rejects a payoff that runs past 50 years", () => {
    // $100k at 5% ($417/mo interest) with $420 takes ~97 years.
    const result = resolveLoanDetails(100_000, "auto", { interestRate: 0.05, monthlyPayment: "420" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain("years to pay off");
  });

  it("accepts a payoff exactly at the 50-year ceiling", () => {
    const payment = calcPayment(100_000, 0.05, MAX_LOAN_TERM_MONTHS);
    const result = resolveLoanDetails(100_000, "auto", {
      interestRate: 0.05,
      monthlyPayment: payment.toFixed(2),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.columns.termMonths).toBeLessThanOrEqual(MAX_LOAN_TERM_MONTHS);
  });

  it("floors the term at one month when the payment exceeds the balance", () => {
    // calcTerm rounds this to 0, and a 0-month schedule reads as held-flat.
    const result = resolveLoanDetails(500, "auto", { interestRate: 0.06, monthlyPayment: "5000" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.columns.termMonths).toBe(1);
  });
});

describe("the credit-card rule", () => {
  it("refuses payment terms on a card, which the engine holds flat anyway", () => {
    expect(resolveLoanDetails(2_000, "credit_card", { monthlyPayment: "50" })).toEqual({
      ok: false,
      error: "A credit card is held at its balance and doesn't take payment terms.",
    });
  });

  it("still lets a card CLEAR its terms", () => {
    expect(resolveLoanDetails(2_000, "credit_card", { monthlyPayment: "" })).toEqual({
      ok: true,
      columns: CLEARED_LOAN_COLUMNS,
    });
  });

  it("stores a derived term as MONTHS so the advisor form round-trips it", () => {
    // termUnit defaults to "annual"; 239 months would render as 19.9166 years
    // and parseInt() back to 228 on the advisor's next save.
    const r = resolveLoanDetails(56_302.06, "mortgage", {
      interestRate: 0.0649, monthlyPayment: "420",
    });
    if (!r.ok) throw new Error("expected success");
    expect(r.columns.termMonths).toBe(239);
    expect(r.columns.termUnit).toBe("monthly");
  });
});

describe("supportsLoanDetails", () => {
  it("is false for credit cards — the engine holds them flat", () => {
    expect(supportsLoanDetails("credit_card")).toBe(false);
  });

  it("is true for every amortizing type", () => {
    for (const t of ["mortgage", "heloc", "auto", "student", "personal", "other", null]) {
      expect(supportsLoanDetails(t)).toBe(true);
    }
  });
});

describe("payoffYear", () => {
  it("mirrors the engine's schedule window: startYear + ceil(term/12) - 1", () => {
    expect(payoffYear(2026, 1)).toBe(2026);
    expect(payoffYear(2026, 12)).toBe(2026);
    expect(payoffYear(2026, 13)).toBe(2027);
    expect(payoffYear(2026, 24)).toBe(2027);
    // The measured case: $56,302 at 6.49% paying $420/mo.
    expect(payoffYear(2026, 239)).toBe(2045);
  });

  it("is null without a term", () => {
    expect(payoffYear(2026, null)).toBeNull();
    expect(payoffYear(2026, 0)).toBeNull();
  });

  it("carries a mid-year origination into the year its term really ends", () => {
    // A debt the ADVISOR entered keeps its real origination month, and the
    // schedule only makes 12 - startMonth + 1 payments in the first calendar
    // year. A July 2020 30-year mortgage runs through June 2050, so quoting
    // 2049 would name a year the plan still shows a balance in.
    expect(payoffYear(2020, 360, 7)).toBe(2050);
    expect(payoffYear(2024, 60, 10)).toBe(2029);
    // January is unchanged, and an omitted month still means January.
    expect(payoffYear(2024, 60, 1)).toBe(2028);
    expect(payoffYear(2024, 60)).toBe(2028);
  });
});

/**
 * The contract between what the portal STORES and what the projection DOES.
 * Everything above proves the numbers are internally consistent; this proves
 * the engine agrees, which is the only reason a client types them in.
 */
describe("the stored shape against the real engine", () => {
  const YEAR = 2026;

  /** Exactly what the portal routes write for these inputs. */
  function stored(balance: number, rate: number, payment: string) {
    const r = resolveLoanDetails(balance, "auto", { interestRate: rate, monthlyPayment: payment });
    if (!r.ok) throw new Error(`expected resolvable terms: ${r.error}`);
    return {
      id: "liab-1",
      name: "Auto Loan",
      liabilityType: "auto" as const,
      balance,
      interestRate: Number(r.columns.interestRate),
      monthlyPayment: Number(r.columns.monthlyPayment),
      termMonths: r.columns.termMonths,
      startYear: YEAR,
      startMonth: 1, // the routes pin January — see payoffYear()
    } as unknown as Liability;
  }

  it("holds the debt flat until terms are entered, then amortizes it", () => {
    const withTerms = stored(22_687.59, 0.0649, "512.43");
    const without = { ...withTerms, monthlyPayment: 0, interestRate: 0, termMonths: null };
    expect(isHeldFlatLiability(without as unknown as Liability)).toBe(true);
    expect(buildLiabilitySchedules([without as unknown as Liability]).size).toBe(0);
    expect(isHeldFlatLiability(withTerms)).toBe(false);
    expect(buildLiabilitySchedules([withTerms]).get("liab-1")!.length).toBeGreaterThan(1);
  });

  it("pays the balance down to zero with NO phantom balloon in the final year", () => {
    // A mid-year startMonth would leave the schedule short of window, and
    // computeAmortizationSchedule's "absorb the rounding dust" step would wipe
    // a real four-figure balance in one go. Measured at $7,654 vs $5,040/yr.
    const liab = stored(56_302.06, 0.0649, "420");
    const sched = buildLiabilitySchedules([liab]).get("liab-1")!;
    const last = sched[sched.length - 1];
    const fullYear = 420 * 12;

    expect(last.endingBalance).toBeLessThan(1);
    expect(last.payment).toBeLessThanOrEqual(fullYear);
    for (const row of sched) expect(row.payment).toBeLessThanOrEqual(fullYear + 0.01);
  });

  it("pays off in the very year the client was shown", () => {
    for (const [balance, rate, payment] of [
      [56_302.06, 0.0649, "420"],
      [22_687.59, 0.0649, "512.43"],
      [12_000, 0, "500"],
    ] as const) {
      const liab = stored(balance, rate, payment);
      const sched = buildLiabilitySchedules([liab]).get("liab-1")!;
      expect(sched[sched.length - 1].year).toBe(payoffYear(YEAR, liab.termMonths));
    }
  });

  it("names the engine's payoff year for an ADVISOR-entered mid-year loan too", () => {
    // The portal renders every debt, not only the ones a client typed terms
    // into. An advisor's mortgage keeps its true origination month, so the
    // year quoted to the client has to be read with that month.
    const liab = {
      ...stored(56_302.06, 0.0649, "420"),
      startMonth: 7,
    } as unknown as Liability;
    const sched = buildLiabilitySchedules([liab]).get("liab-1")!;
    expect(sched[sched.length - 1].year).toBe(
      payoffYear(YEAR, liab.termMonths, 7)
    );
  });

  it("starts the schedule at today's balance, not a back-dated original", () => {
    const liab = stored(56_302.06, 0.0649, "420");
    const sched = buildLiabilitySchedules([liab]).get("liab-1")!;
    expect(sched[0].year).toBe(YEAR);
    expect(sched[0].beginningBalance).toBeCloseTo(56_302.06, 2);
  });
});
