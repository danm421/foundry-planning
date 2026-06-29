import { describe, it, expect } from "vitest";
import { computeIncome } from "../income";
import { sampleIncomes, baseClient } from "./fixtures";
import type { Income, ClientInfo } from "../types";

describe("computeIncome", () => {
  it("sums active salary income for the year", () => {
    const result = computeIncome(sampleIncomes, 2026, baseClient);
    // John: 150000, Jane: 100000
    expect(result.salaries).toBe(250000);
    expect(result.total).toBe(250000);
  });

  it("applies growth rate in subsequent years", () => {
    const result = computeIncome(sampleIncomes, 2027, baseClient);
    // John: 150000 * 1.03 = 154500, Jane: 100000 * 1.03 = 103000
    expect(result.salaries).toBeCloseTo(257500, 0);
  });

  it("excludes income outside its start/end year range", () => {
    const result = computeIncome(sampleIncomes, 2036, baseClient);
    // John salary ends 2035, Jane salary still active
    // Jane: 100000 * 1.03^10 = 134391.64
    expect(result.salaries).toBeCloseTo(134391.64, 0);
  });

  it("delays social security until claiming age", () => {
    // John born 1970, claiming age 67 → starts 2037
    const before = computeIncome(sampleIncomes, 2036, baseClient);
    expect(before.socialSecurity).toBe(0);

    const after = computeIncome(sampleIncomes, 2037, baseClient);
    // SS: 36000 * 1.02^11 (11 years of COLA from 2026)
    expect(after.socialSecurity).toBeCloseTo(36000 * Math.pow(1.02, 11), 0);
  });

  it("returns all zeros when no income is active", () => {
    const result = computeIncome([], 2026, baseClient);
    expect(result.total).toBe(0);
    expect(result.salaries).toBe(0);
    expect(result.socialSecurity).toBe(0);
  });
});

const client: ClientInfo = {
  firstName: "Test",
  lastName: "User",
  dateOfBirth: "1960-06-01",   // FRA 67y 0m
  retirementAge: 65,
  planEndAge: 95,
  filingStatus: "single",
};

describe("computeIncome — SS pia_at_fra mode", () => {
  it("computes benefit from PIA using FRA adjustments", () => {
    const ss: Income = {
      id: "ss1",
      type: "social_security",
      name: "Client SS",
      annualAmount: 0,            // unused in pia_at_fra
      startYear: 2022,            // for inflationStartYear semantics below
      endYear: 2099,
      growthRate: 0,              // no COLA for this test
      owner: "client",
      claimingAge: 67,            // FRA
      claimingAgeMonths: 0,
      ssBenefitMode: "pia_at_fra",
      piaMonthly: 2000,
      inflationStartYear: 2022,
    };
    // At FRA: monthly PIA × 12 = 24000
    const result = computeIncome([ss], 2027, client);
    expect(result.socialSecurity).toBeCloseTo(24000, 2);
  });

  it("applies early reduction: claim-62 FRA-67 → 70% of annual PIA", () => {
    const ss: Income = {
      id: "ss1",
      type: "social_security",
      name: "Client SS",
      annualAmount: 0,
      startYear: 2022,
      endYear: 2099,
      growthRate: 0,
      owner: "client",
      claimingAge: 62,
      claimingAgeMonths: 0,
      ssBenefitMode: "pia_at_fra",
      piaMonthly: 2000,
      inflationStartYear: 2022,
    };
    // 2000 × 0.70 × 12 = 16800
    const result = computeIncome([ss], 2022, client);
    expect(result.socialSecurity).toBeCloseTo(16800, 2);
  });

  it("returns 0 before claiming age", () => {
    const ss: Income = {
      id: "ss1",
      type: "social_security",
      name: "Client SS",
      annualAmount: 0,
      startYear: 2020,
      endYear: 2099,
      growthRate: 0,
      owner: "client",
      claimingAge: 67,
      claimingAgeMonths: 0,
      ssBenefitMode: "pia_at_fra",
      piaMonthly: 2000,
      inflationStartYear: 2020,
    };
    const result = computeIncome([ss], 2025, client); // age 65, not yet 67
    expect(result.socialSecurity).toBe(0);
  });

  it("applies growthRate from inflationStartYear to PIA", () => {
    const ss: Income = {
      id: "ss1",
      type: "social_security",
      name: "Client SS",
      annualAmount: 0,
      startYear: 2022,
      endYear: 2099,
      growthRate: 0.03,  // 3% COLA
      owner: "client",
      claimingAge: 67,
      claimingAgeMonths: 0,
      ssBenefitMode: "pia_at_fra",
      piaMonthly: 2000,
      inflationStartYear: 2022,
    };
    // Year 2027 claim at FRA, 5 years of 3% growth: 24000 × 1.03^5 ≈ 27820.85
    const result = computeIncome([ss], 2027, client);
    expect(result.socialSecurity).toBeCloseTo(24000 * Math.pow(1.03, 5), 2);
  });
});

describe("computeIncome — SS manual_amount mode (regression)", () => {
  it("behaves identically to pre-ssBenefitMode rows when mode is 'manual_amount'", () => {
    const ss: Income = {
      id: "ss1",
      type: "social_security",
      name: "Client SS",
      annualAmount: 30000,
      startYear: 2022,
      endYear: 2099,
      growthRate: 0.02,
      owner: "client",
      claimingAge: 67,
      ssBenefitMode: "manual_amount",
      inflationStartYear: 2022,
    };
    // 30000 × 1.02^5 ≈ 33122.42
    const result = computeIncome([ss], 2027, client);
    expect(result.socialSecurity).toBeCloseTo(30000 * Math.pow(1.02, 5), 2);
  });
  it("behaves identically when ssBenefitMode is undefined (existing data)", () => {
    const ss: Income = {
      id: "ss1",
      type: "social_security",
      name: "Client SS",
      annualAmount: 30000,
      startYear: 2022,
      endYear: 2099,
      growthRate: 0.02,
      owner: "client",
      claimingAge: 67,
      // no ssBenefitMode
      inflationStartYear: 2022,
    };
    const result = computeIncome([ss], 2027, client);
    expect(result.socialSecurity).toBeCloseTo(30000 * Math.pow(1.02, 5), 2);
  });
});

describe("computeIncome — SS no_benefit mode", () => {
  it("returns 0 for a no_benefit row regardless of PIA or annualAmount", () => {
    const ss: Income = {
      id: "ss1",
      type: "social_security",
      name: "Client SS",
      annualAmount: 30000,              // ignored
      startYear: 2022,
      endYear: 2099,
      growthRate: 0,
      owner: "client",
      claimingAge: 67,
      ssBenefitMode: "no_benefit",
      piaMonthly: 2000,                  // ignored
      inflationStartYear: 2022,
    };
    const result = computeIncome([ss], 2027, client); // age 67, claim met
    expect(result.socialSecurity).toBe(0);
    expect(result.bySource[ss.id]).toBeUndefined();
  });
});

describe("computeIncome — SS pia_at_fra with claimingAgeMode='fra'", () => {
  it("resolves claim age to FRA dynamically (67y for DOB 1960)", () => {
    const ss: Income = {
      id: "ss1",
      type: "social_security",
      name: "Client SS",
      annualAmount: 0,
      startYear: 2022,
      endYear: 2099,
      growthRate: 0,
      owner: "client",
      claimingAge: 62,                   // should be ignored; mode is "fra"
      claimingAgeMonths: 0,
      ssBenefitMode: "pia_at_fra",
      piaMonthly: 2000,
      claimingAgeMode: "fra",
      inflationStartYear: 2022,
    };
    // Client born 1960-06-01 → FRA 67y 0m. Year 2027 = age 67, just claimed.
    // At FRA, benefit = PIA unchanged = 24000/yr.
    const result = computeIncome([ss], 2027, client);
    expect(result.socialSecurity).toBeCloseTo(24000, 2);
  });

  it("returns 0 before FRA even if claimingAge year would have already fired", () => {
    const ss: Income = {
      id: "ss1",
      type: "social_security",
      name: "Client SS",
      annualAmount: 0,
      startYear: 2022,
      endYear: 2099,
      growthRate: 0,
      owner: "client",
      claimingAge: 62,                   // ignored
      ssBenefitMode: "pia_at_fra",
      piaMonthly: 2000,
      claimingAgeMode: "fra",
      inflationStartYear: 2022,
    };
    // 2025: age 65 < FRA 67 → 0.
    expect(computeIncome([ss], 2025, client).socialSecurity).toBe(0);
  });
});

describe("computeIncome — stress test", () => {
  it("haircuts social security for years at/after startYear", () => {
    // sampleIncomes has John SS (manual, 36000 @ COLA 2%, claimingAge 67 → 2037).
    const base = computeIncome(sampleIncomes, 2037, baseClient);
    const cut = computeIncome(sampleIncomes, 2037, baseClient, undefined, {
      ssBenefitHaircut: { pct: 0.23, startYear: 2034 },
    });
    expect(cut.socialSecurity).toBeCloseTo(base.socialSecurity * 0.77, 2);
  });

  it("does not haircut social security before startYear", () => {
    const base = computeIncome(sampleIncomes, 2037, baseClient);
    const cut = computeIncome(sampleIncomes, 2037, baseClient, undefined, {
      ssBenefitHaircut: { pct: 0.23, startYear: 2040 },
    });
    expect(cut.socialSecurity).toBeCloseTo(base.socialSecurity, 2);
  });

  it("stops the disabled person's salary from startYear forward", () => {
    // 2030: John salary active (owner client), Jane salary active (owner spouse).
    const before = computeIncome(sampleIncomes, 2030, baseClient);
    const disabled = computeIncome(sampleIncomes, 2030, baseClient, undefined, {
      disabilityEvent: { person: "client", startYear: 2030 },
    });
    // John's salary drops out; Jane's remains.
    const janeOnly = computeIncome(
      sampleIncomes.filter((i) => i.id === "inc-salary-jane"),
      2030,
      baseClient,
    );
    expect(disabled.salaries).toBeCloseTo(janeOnly.salaries, 2);
    expect(disabled.salaries).toBeLessThan(before.salaries);
  });

  it("leaves salary intact before the disability startYear", () => {
    const before = computeIncome(sampleIncomes, 2030, baseClient);
    const notYet = computeIncome(sampleIncomes, 2030, baseClient, undefined, {
      disabilityEvent: { person: "client", startYear: 2031 },
    });
    expect(notYet.salaries).toBeCloseTo(before.salaries, 2);
  });

  it("haircuts SS total AND per-spouse detail buckets on the pia_at_fra path", () => {
    // ── Why this row routes through the pia_at_fra branch ──────────────────────
    // income.ts line 107: the branch fires when
    //   inc.type === "social_security"  (true)
    //   inc.claimingAge != null         (true, 67)
    //   inc.ssBenefitMode === "pia_at_fra" (true)
    //   inc.piaMonthly != null          (true, 2000)
    //   year >= birthYear + claimAgeMonths/12 (2027 >= 1960 + 67 = 2027, true)
    // The generic manual-amount path (line 143: if inc.type === "social_security")
    // is NOT reached because the pia_at_fra block ends with `continue`.
    //
    // The detail bucket populated: client.retirement (Case 3 / own-only — no spouse row
    // is provided, so resolveAnnualBenefit falls through to Case 3 and returns
    // retirement = annualize(own), spousal = 0, survivor = 0).
    // ───────────────────────────────────────────────────────────────────────────
    const ssRow: Income = {
      id: "ss-pia-stress",
      type: "social_security",
      name: "Client SS (pia_at_fra)",
      annualAmount: 0,           // unused by pia_at_fra branch
      startYear: 2020,
      endYear: 2099,
      growthRate: 0,             // no COLA — keeps expected values exact
      owner: "client",
      claimingAge: 67,           // FRA for DOB 1960 → first active year = 2027
      claimingAgeMonths: 0,
      ssBenefitMode: "pia_at_fra",
      piaMonthly: 2000,
      inflationStartYear: 2020,
    };

    // `client` is defined in this file (DOB 1960-06-01, single, lifeExpectancy absent).
    // Year 2027: client is exactly 67 → benefit is active.
    const testYear = 2027;
    const haircut = { pct: 0.23, startYear: testYear - 3 }; // startYear well before testYear

    const base = computeIncome([ssRow], testYear, client);
    const cut  = computeIncome([ssRow], testYear, client, undefined, {
      ssBenefitHaircut: haircut,
    });

    // Sanity: benefit must be non-zero (proves we're in the pia_at_fra branch,
    // not the generic path which only fires if there's no `continue` above it).
    // At FRA with no COLA: 2000 × 12 = 24000.
    expect(base.socialSecurity).toBeGreaterThan(0);
    // The detail bucket is ONLY populated by the pia_at_fra branch (the generic
    // path never sets socialSecurityDetail), so its presence proves the branch was taken.
    expect(base.socialSecurityDetail).toBeDefined();
    expect(base.socialSecurityDetail!.client.retirement).toBeGreaterThan(0);

    // Primary assertion: haircut scales the pia_at_fra total.
    expect(cut.socialSecurity).toBeCloseTo(base.socialSecurity * 0.77, 4);

    // Secondary assertion: the per-spouse retirement bucket also scales.
    // A regression that drops `* ssFactor` from bucket.retirement (income.ts line 124)
    // would leave this equal to base while cut.socialSecurity is reduced — caught here.
    expect(cut.socialSecurityDetail).toBeDefined();
    expect(cut.socialSecurityDetail!.client.retirement).toBeCloseTo(
      base.socialSecurityDetail!.client.retirement * 0.77,
      4,
    );

    // No-op before startYear: haircut configured AFTER testYear should leave benefit intact.
    const noOp = computeIncome([ssRow], testYear, client, undefined, {
      ssBenefitHaircut: { pct: 0.23, startYear: testYear + 1 },
    });
    expect(noOp.socialSecurity).toBeCloseTo(base.socialSecurity, 4);
  });
});
