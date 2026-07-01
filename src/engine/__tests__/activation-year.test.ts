import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { basePlanSettings, buildClientData } from "./fixtures";
import type { Account } from "../types";

/**
 * Task 3 — future-activated accounts. An account with a resolved
 * `activationYear` must not exist in the projection before that year (no ledger
 * entry, zero balance, no contributions), then appear at its entered `value`
 * (a windfall) in the activation year and grow normally after. Uses
 * `activationYearRef: null` so no milestone resolution is involved.
 */
describe("account activation year", () => {
  it("account is absent before activation and appears at entered value in the activation year", () => {
    const future: Account = {
      id: "future-1",
      name: "Inheritance",
      category: "taxable",
      subType: "brokerage",
      titlingType: "jtwros",
      value: 100000,
      basis: 100000,
      growthRate: 0,
      rmdEnabled: false,
      owners: [],
      activationYear: 2030,
      activationYearRef: null,
    };
    const base = buildClientData({
      planSettings: { ...basePlanSettings, planStartYear: 2025, planEndYear: 2035 },
    });
    const data = { ...base, accounts: [...base.accounts, future] };

    const years = runProjection(data);
    const y2029 = years.find((y) => y.year === 2029)!;
    const y2030 = years.find((y) => y.year === 2030)!;

    // Absent before activation: no ledger entry at all.
    expect(y2029.accountLedgers["future-1"]).toBeUndefined();
    // Seeded at entered value in the activation year.
    expect(y2030.accountLedgers["future-1"]?.beginningValue).toBe(100000);
  });

  it("grows only from activation (growth rate applied 2030→2031, none before)", () => {
    const future: Account = {
      id: "future-2",
      name: "Future acct",
      category: "taxable",
      subType: "brokerage",
      titlingType: "jtwros",
      value: 100000,
      basis: 100000,
      growthRate: 0.1,
      rmdEnabled: false,
      owners: [],
      activationYear: 2030,
      activationYearRef: null,
    };
    const base = buildClientData({
      planSettings: { ...basePlanSettings, planStartYear: 2025, planEndYear: 2035 },
    });
    const data = { ...base, accounts: [...base.accounts, future] };

    const years = runProjection(data);
    // 2031 beginning = 2030 seed (100k) grown one year at 10% = 110k.
    expect(
      years.find((y) => y.year === 2031)!.accountLedgers["future-2"]?.beginningValue,
    ).toBeCloseTo(110000, 0);
  });
});
