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
