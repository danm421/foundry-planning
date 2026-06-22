import { describe, it, expect } from "vitest";
import { computeLiabilities } from "@/engine/liabilities";
import {
  buildLiabilitySchedules,
  scheduleBoYBalance,
} from "@/engine/liability-schedules";
import type { Liability } from "@/engine/types";

const card: Liability = {
  id: "cc1",
  name: "Visa",
  balance: 5000,
  interestRate: 0,
  monthlyPayment: 0,
  startYear: 2026,
  startMonth: 1,
  termMonths: 0,
  liabilityType: "credit_card",
  extraPayments: [],
  owners: [],
};

const mortgage: Liability = {
  id: "m1",
  name: "Home",
  balance: 300000,
  interestRate: 0.05,
  monthlyPayment: 1610.46,
  startYear: 2020,
  startMonth: 1,
  termMonths: 360,
  liabilityType: "mortgage",
  extraPayments: [],
  owners: [],
};

// A Plaid-synced loan: the portal commit route creates EVERY Plaid debt with
// held-flat defaults (monthlyPayment 0, termMonths 0, interestRate 0) regardless
// of type. A non-revolving type with no amortization term must be held flat —
// otherwise an empty schedule silently zeroes the balance off the projection.
const plaidLoan: Liability = {
  id: "auto1",
  name: "Auto loan (Plaid)",
  balance: 20000,
  interestRate: 0,
  monthlyPayment: 0,
  startYear: 2026,
  startMonth: 1,
  termMonths: 0,
  liabilityType: "auto",
  extraPayments: [],
  owners: [],
};

// A loan-shaped liability that DOES carry a real amortization term (e.g. an
// advisor-entered auto loan, or a Plaid debt linked to one). The held-flat rule
// must NOT capture this — it still amortizes.
const realAutoLoan: Liability = {
  id: "auto2",
  name: "Auto loan (advisor-entered)",
  balance: 20000,
  interestRate: 0.06,
  monthlyPayment: 386.66,
  startYear: 2026,
  startMonth: 1,
  termMonths: 60,
  liabilityType: "auto",
  extraPayments: [],
  owners: [],
};

// A bequeathed Plaid loan: liability-bequests.ts copies liabilityType AND
// termMonths onto heir rows, so a distributed Plaid loan still has termMonths 0
// and must remain held flat after the bequest.
const bequeathedPlaidLoan: Liability = {
  id: "auto-bequest1",
  name: "Auto loan (Plaid) — bequest to heir",
  balance: 12000,
  interestRate: 0,
  monthlyPayment: 0,
  startYear: 2026,
  startMonth: 1,
  termMonths: 0,
  liabilityType: "auto",
  extraPayments: [],
  owners: [],
};

describe("revolving liability is held flat", () => {
  it("buildLiabilitySchedules omits revolving rows from the map", () => {
    const map = buildLiabilitySchedules([card, mortgage]);
    expect(map.has("cc1")).toBe(false); // omitted → projection BoY fallback holds it flat
    expect(map.has("m1")).toBe(true);
  });

  it("computeLiabilities holds the card balance flat (NOT zero) with no payment/interest", () => {
    const map = buildLiabilitySchedules([card, mortgage]);
    const res = computeLiabilities([card], 2030, undefined, map);
    expect(res.byLiability["cc1"]).toBe(0); // no payment outflow
    expect(res.interestByLiability["cc1"]).toBe(0); // no accrual
    expect(res.updatedLiabilities[0].balance).toBe(5000); // held flat, not dropped to 0
    expect(res.totalPayment).toBe(0);
  });

  it("does NOT regress the amortizing mortgage", () => {
    const map = buildLiabilitySchedules([mortgage]);
    const boy2021 = scheduleBoYBalance(map.get("m1")!, 2021);
    expect(boy2021).toBeGreaterThan(290000);
    expect(boy2021).toBeLessThan(300000); // a year of payments reduced it
    const res = computeLiabilities([mortgage], 2021, undefined, map);
    expect(res.byLiability["m1"]).toBeGreaterThan(0);
  });
});

describe("no-schedule liability (Plaid loan) is held flat, not zeroed", () => {
  it("buildLiabilitySchedules omits a non-revolving loan with no term", () => {
    const map = buildLiabilitySchedules([plaidLoan, mortgage]);
    expect(map.has("auto1")).toBe(false); // no term → no schedule → held flat via BoY fallback
    expect(map.has("m1")).toBe(true);
  });

  it("computeLiabilities holds the Plaid loan balance flat (NOT zero) with no payment/interest", () => {
    const map = buildLiabilitySchedules([plaidLoan]);
    const res = computeLiabilities([plaidLoan], 2030, undefined, map);
    expect(res.byLiability["auto1"]).toBe(0); // no payment outflow
    expect(res.interestByLiability["auto1"]).toBe(0); // no accrual
    expect(res.updatedLiabilities[0].balance).toBe(20000); // held flat, NOT silently dropped to 0
    expect(res.totalPayment).toBe(0);
  });

  it("computeLiabilities held-flat path works even with no schedule map provided", () => {
    // No schedules arg: must NOT fall through to buildLiabilitySchedule (empty → 0).
    const res = computeLiabilities([plaidLoan], 2030);
    expect(res.updatedLiabilities[0].balance).toBe(20000);
    expect(res.byLiability["auto1"]).toBe(0);
  });

  it("does NOT over-hold-flat a real loan WITH a term (link-to-existing regression guard)", () => {
    const map = buildLiabilitySchedules([realAutoLoan]);
    expect(map.has("auto2")).toBe(true); // has a real term → amortizes
    const res = computeLiabilities([realAutoLoan], 2027, undefined, map);
    expect(res.byLiability["auto2"]).toBeGreaterThan(0); // it pays down
    expect(res.updatedLiabilities[0].balance).toBeLessThan(20000); // balance amortizes
  });

  it("holds a bequeathed Plaid loan (termMonths 0) flat", () => {
    const map = buildLiabilitySchedules([bequeathedPlaidLoan]);
    expect(map.has("auto-bequest1")).toBe(false);
    const res = computeLiabilities([bequeathedPlaidLoan], 2030, undefined, map);
    expect(res.updatedLiabilities[0].balance).toBe(12000);
    expect(res.byLiability["auto-bequest1"]).toBe(0);
  });
});
