import { describe, it, expect } from "vitest";
import { computeIncome, applyDisabilityEvent } from "../income";
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
    // John born 1970-01-01, claiming age 67. A January-1 birth attains 67 on
    // 2036-12-31, so December 2036 is his first entitlement month — one payment
    // that year, then full years after.
    const beforeAny = computeIncome(sampleIncomes, 2035, baseClient);
    expect(beforeAny.socialSecurity).toBe(0);

    const firstMonth = computeIncome(sampleIncomes, 2036, baseClient);
    expect(firstMonth.socialSecurity).toBeCloseTo(3000 * Math.pow(1.02, 10), 2);

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

// Born on the 1st, so this client attains every age on the last day of the
// prior month (SSA's day-before-the-birthday rule) and is entitled from May.
// May..December is eight payments, so a claim year is worth 8/12 of a full year.
const CLAIM_YEAR_MONTHS = 8;

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
    // At FRA: monthly PIA 2000, entitled from May 2027 → eight payments.
    const result = computeIncome([ss], 2027, client);
    expect(result.socialSecurity).toBeCloseTo(2000 * CLAIM_YEAR_MONTHS, 2);
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
    // A worker born on the 1st is 62 throughout their birthday month, so
    // entitlement is June 2022 — seven payments, and 59 months before the May
    // 2027 FRA month rather than 60. Reduction = 36×5/9% + 23×5/12% = 29.583%.
    const monthly = 2000 * (1 - 36 * (5 / 900) - 23 * (5 / 1200));
    const result = computeIncome([ss], 2022, client);
    expect(result.socialSecurity).toBeCloseTo(monthly * 7, 2);
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
    // Year 2027 claim at FRA, 5 years of 3% growth, eight payments.
    const result = computeIncome([ss], 2027, client);
    expect(result.socialSecurity).toBeCloseTo(2000 * CLAIM_YEAR_MONTHS * Math.pow(1.03, 5), 2);
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
    // 30000 × 1.02^5 ≈ 33122.42, prorated to the eight months payable in 2027.
    const result = computeIncome([ss], 2027, client);
    expect(result.socialSecurity).toBeCloseTo(30000 * Math.pow(1.02, 5) * (CLAIM_YEAR_MONTHS / 12), 2);
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
    // Same eight-month claim year as the explicit manual_amount row above —
    // that equivalence is the point of this regression pair.
    const result = computeIncome([ss], 2027, client);
    expect(result.socialSecurity).toBeCloseTo(30000 * Math.pow(1.02, 5) * (CLAIM_YEAR_MONTHS / 12), 2);
  });
});

describe("computeIncome — the claim year is prorated by birth month", () => {
  function ssRow(): Income {
    return {
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
      piaMonthly: 3000,
      inflationStartYear: 2020,
    };
  }
  function at(dob: string): ClientInfo {
    return { ...client, dateOfBirth: dob };
  }

  it("pays a December birthday one month in the claim year, not twelve", () => {
    const dec = at("1960-12-15");
    expect(computeIncome([ssRow()], 2026, dec).socialSecurity).toBe(0);
    expect(computeIncome([ssRow()], 2027, dec).socialSecurity).toBeCloseTo(3000 * 1, 2);
    expect(computeIncome([ssRow()], 2028, dec).socialSecurity).toBeCloseTo(3000 * 12, 2);
  });

  it("pays a June birthday seven months in the claim year", () => {
    const jun = at("1960-06-15");
    expect(computeIncome([ssRow()], 2027, jun).socialSecurity).toBeCloseTo(3000 * 7, 2);
    expect(computeIncome([ssRow()], 2028, jun).socialSecurity).toBeCloseTo(3000 * 12, 2);
  });

  it("pays a mid-January birthday a nearly full claim year", () => {
    const jan = at("1960-01-15");
    expect(computeIncome([ssRow()], 2027, jan).socialSecurity).toBeCloseTo(3000 * 12, 2);
  });

  it("starts extra claim-age months in the right month instead of skipping a year", () => {
    // 67y 6m from a 1960-06-15 birth → entitled December 2027, one payment that
    // year. The year-granular gate this replaced paid zero in 2027 and a full
    // twelve in 2028.
    const row = { ...ssRow(), claimingAgeMonths: 6 };
    const jun = at("1960-06-15");
    const monthly = 3000 * (1 + 6 * (2 / 300)); // six months of delayed credits
    expect(computeIncome([row], 2027, jun).socialSecurity).toBeCloseTo(monthly * 1, 2);
    expect(computeIncome([row], 2028, jun).socialSecurity).toBeCloseTo(monthly * 12, 2);
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
    // Client born 1960-06-01 → FRA 67y 0m, entitled from May 2027.
    // At FRA, benefit = PIA unchanged = 2000/mo × eight payments.
    const result = computeIncome([ss], 2027, client);
    expect(result.socialSecurity).toBeCloseTo(2000 * CLAIM_YEAR_MONTHS, 2);
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

  // Disability suspends the row itself (applyDisabilityEvent) rather than being
  // filtered inside computeIncome, so the stop is visible to the cash-routing
  // and tax-base loops too. The end-to-end consequences live in
  // stress-disability.test.ts; these assert the suspension itself.
  it("stops the disabled person's salary from startYear forward", () => {
    // 2030: John salary active (owner client), Jane salary active (owner spouse).
    const before = computeIncome(sampleIncomes, 2030, baseClient);
    const disabled = computeIncome(
      applyDisabilityEvent(sampleIncomes, { person: "client", startYear: 2030 }),
      2030,
      baseClient,
    );
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
    const notYet = computeIncome(
      applyDisabilityEvent(sampleIncomes, { person: "client", startYear: 2031 }),
      2030,
      baseClient,
    );
    expect(notYet.salaries).toBeCloseTo(before.salaries, 2);
  });

  it("suppresses an end-at-retirement salary's prorated retirement-year slice", () => {
    // A row whose end is anchored to retirement stays partly included in the
    // retirement year even past `endYear`. The gate has to check the suspension
    // BEFORE that proration, or the disabled person keeps a sliver of paycheck.
    const anchored: Income[] = [
      { ...sampleIncomes[0], endYear: 2034, endYearRef: "client_retirement" },
    ];
    const stopped = applyDisabilityEvent(anchored, { person: "client", startYear: 2030 });
    const retirementYear = 2035; // baseClient: born 1970, retires at 65
    expect(computeIncome(stopped, retirementYear, {
      ...baseClient,
      retirementMonth: 7,
    }).salaries).toBe(0);
  });

  // ── A disability that ends ────────────────────────────────────────────────
  it("pays nothing through the last disabled year", () => {
    const stopped = applyDisabilityEvent(sampleIncomes, {
      person: "client",
      startYear: 2030,
      endYear: 2033,
    });
    const janeOnly = sampleIncomes.filter((i) => i.id === "inc-salary-jane");
    for (const year of [2030, 2031, 2032, 2033]) {
      expect(computeIncome(stopped, year, baseClient).salaries).toBeCloseTo(
        computeIncome(janeOnly, year, baseClient).salaries,
        2,
      );
    }
  });

  it("resumes the salary the year after, at the level it would have reached", () => {
    const stopped = applyDisabilityEvent(sampleIncomes, {
      person: "client",
      startYear: 2030,
      endYear: 2033,
    });
    // Growth keeps compounding through the stopped years — the row's own
    // start year is untouched, so 2034 pays exactly what an undisabled 2034
    // would have. Splitting the row and restarting its growth clock in 2034
    // would pay the 2029 amount here, ~16% lower.
    expect(computeIncome(stopped, 2034, baseClient).salaries).toBeCloseTo(
      computeIncome(sampleIncomes, 2034, baseClient).salaries,
      2,
    );
  });

  it("treats an end year before the start year as one disabled year, not as no disability", () => {
    // An inverted window suspends nothing, so read literally the whole stressor
    // goes inert: the paycheck never stops. The solver's own field prevents the
    // ordering, but a saved scenario or an older draft can still carry it.
    const stopped = applyDisabilityEvent(sampleIncomes, {
      person: "client",
      startYear: 2030,
      endYear: 2025,
    });
    const janeOnly = sampleIncomes.filter((i) => i.id === "inc-salary-jane");
    expect(computeIncome(stopped, 2030, baseClient).salaries).toBeCloseTo(
      computeIncome(janeOnly, 2030, baseClient).salaries,
      2,
    );
    expect(computeIncome(stopped, 2031, baseClient).salaries).toBeCloseTo(
      computeIncome(sampleIncomes, 2031, baseClient).salaries,
      2,
    );
  });

  it("keeps the salary stopped for good when no end year is given", () => {
    const stopped = applyDisabilityEvent(sampleIncomes, {
      person: "client",
      startYear: 2030,
    });
    const janeOnly = sampleIncomes.filter((i) => i.id === "inc-salary-jane");
    expect(computeIncome(stopped, 2034, baseClient).salaries).toBeCloseTo(
      computeIncome(janeOnly, 2034, baseClient).salaries,
      2,
    );
  });

  it("leaves an entity-owned business row alone", () => {
    const entityOwned: Income[] = [
      { ...sampleIncomes[0], type: "business", ownerEntityId: "ent-1" },
    ];
    expect(
      applyDisabilityEvent(entityOwned, { person: "client", startYear: 2030 }),
    ).toEqual(entityOwned);
  });

  it("returns the rows untouched when no disability is configured", () => {
    expect(applyDisabilityEvent(sampleIncomes, undefined)).toBe(sampleIncomes);
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
