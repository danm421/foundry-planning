import { describe, it, expect } from "vitest";
import {
  resolveCoverage,
  benefitForYear,
  synthesizeDisabilityBenefits,
  DAYS_PER_MONTH,
} from "../disability-benefits";
import { baseClient, basePlanSettings, sampleIncomes } from "./fixtures";
import type { DisabilityPolicy } from "../types";

const START = 2028;

/** The plan's default workplace package. */
function workplacePolicy(over: Partial<DisabilityPolicy> = {}): DisabilityPolicy {
  return {
    id: "dp-work",
    name: "Group disability",
    insured: "client",
    coveredEarningsMode: "salary",
    coveredEarningsAmount: null,
    shortTerm: { eliminationDays: 7, benefitPct: 0.6, durationWeeks: 13, monthlyMax: null },
    longTerm: {
      eliminationDays: 90,
      benefitPct: 0.6,
      monthlyMax: 10_000,
      benefitPeriod: { mode: "to_age", age: 65 },
    },
    benefitTaxable: true,
    colaRate: 0,
    annualPremium: 0,
    premiumPayer: "employer",
    ...over,
  };
}

const SALARY_2028 = 159_135; // 150000 * 1.03^2

describe("resolveCoverage", () => {
  it("places the STD window after the elimination period, measured from the disability date", () => {
    const cov = resolveCoverage(workplacePolicy(), SALARY_2028, START, baseClient, 2055);
    expect(cov.shortTerm!.startMonth).toBeCloseTo(7 / DAYS_PER_MONTH, 5);
    expect(cov.shortTerm!.endMonth).toBeCloseTo(91 / DAYS_PER_MONTH, 5);
    // Paid months are duration MINUS elimination — not 13 weeks on top of it.
    expect(cov.shortTerm!.endMonth - cov.shortTerm!.startMonth).toBeCloseTo(2.75975, 4);
  });

  it("ends a to_age benefit period the month the insured reaches that age", () => {
    // DOB 1970-01-01, age 65 => 2035-01. From 2028-01 that is 84 months.
    const cov = resolveCoverage(workplacePolicy(), SALARY_2028, START, baseClient, 2055);
    expect(cov.longTerm!.endMonth).toBe(84);
  });

  it("resolves to_ssnra through the SSA table, not a hardcoded 67", () => {
    const ssnraPolicy = workplacePolicy({
      longTerm: {
        eliminationDays: 90,
        benefitPct: 0.6,
        monthlyMax: null,
        benefitPeriod: { mode: "to_ssnra" },
      },
    });

    // The 1955-1959 band is the ONLY place the SSA table and a hardcoded 67
    // disagree: every effective birth year >= 1960 returns FRA_POST_1960 (67y0m),
    // so a 1970 DOB alone cannot tell the two apart.
    // DOB 1957-06-15 is not a January-1 birth, so fraForBirthDate leaves the
    // effective birth year at 1957 => FRA_TABLE[1957] = 66y 6m.
    // 1957-06 + 66y6m = 2023-12; from 2023-01 that is month 11.
    // A hardcoded 67 * 12 would land on 2024-06 => month 17, and fail here.
    const born1957 = { ...baseClient, dateOfBirth: "1957-06-15" };
    expect(resolveCoverage(ssnraPolicy, SALARY_2028, 2023, born1957, 2055).longTerm!.endMonth)
      .toBe(11);

    // baseClient born 1970 => FRA 67y0m => age 67 in 2037-01 => 108 months.
    const cov = resolveCoverage(ssnraPolicy, SALARY_2028, START, baseClient, 2055);
    expect(cov.longTerm!.endMonth).toBe(108);
  });

  it("never returns an inverted long-term window when the disability starts after the to_age target", () => {
    // DOB 1970-01-01 with to_age 65 targets 2035-01 — twelve years BEFORE a 2047
    // disability, so the raw arithmetic is -144. benefitForYear clamps paid
    // months to 0 either way, but ResolvedCoverage is also the coverage
    // timeline's data source: an inverted window draws a bar ending before it
    // starts.
    const cov = resolveCoverage(
      workplacePolicy({ shortTerm: null }),
      SALARY_2028,
      2047,
      baseClient,
      2055,
    );
    expect(cov.longTerm!.startMonth).toBeCloseTo(90 / DAYS_PER_MONTH, 5);
    expect(cov.longTerm!.endMonth).toBe(cov.longTerm!.startMonth);
    // A zero-width window still pays nothing.
    expect(benefitForYear(cov, 2047, 2047, 0)).toBe(0);
  });

  it("never returns an inverted short-term window when the elimination period outlasts the duration", () => {
    // A 30-day wait on a 2-week benefit: the duration expires before the first
    // paid day. Raw arithmetic gives end 0.45996 < start 0.98563.
    const cov = resolveCoverage(
      workplacePolicy({
        shortTerm: { eliminationDays: 30, benefitPct: 0.6, durationWeeks: 2, monthlyMax: null },
      }),
      SALARY_2028,
      START,
      baseClient,
      2055,
    );
    expect(cov.shortTerm!.startMonth).toBeCloseTo(30 / DAYS_PER_MONTH, 5);
    expect(cov.shortTerm!.endMonth).toBe(cov.shortTerm!.startMonth);
    // Only the LTD layer pays in 2028: 9.04312 months at $7,956.75.
    expect(benefitForYear(cov, START, 2028, 0)).toBeCloseTo(71_953.85, 2);
  });

  it("caps the monthly benefit at the contract maximum", () => {
    // A $424,360 earner at 60% is $21,218/mo raw; the contract cap is $10,000.
    const cov = resolveCoverage(workplacePolicy(), 424_360, START, baseClient, 2055);
    expect(cov.longTerm!.monthlyBenefit).toBe(10_000);
    // STD has no cap on this policy, so it is NOT clipped.
    expect(cov.shortTerm!.monthlyBenefit).toBeCloseTo(424_360 * 0.6 / 12, 2);
  });

  it("treats the default plan's one-day seam as continuous", () => {
    const cov = resolveCoverage(workplacePolicy(), SALARY_2028, START, baseClient, 2055);
    expect(cov.seam).toBeNull();
  });

  it("reports a real gap when LTD waits 180 days after a 13-week STD", () => {
    const cov = resolveCoverage(
      workplacePolicy({
        longTerm: {
          eliminationDays: 180,
          benefitPct: 0.6,
          monthlyMax: 10_000,
          benefitPeriod: { mode: "to_age", age: 65 },
        },
      }),
      SALARY_2028,
      START,
      baseClient,
      2055,
    );
    expect(cov.seam).toEqual({ kind: "gap", months: expect.closeTo(2.92402, 4) });
  });

  it("reports an overlap when STD runs past the LTD elimination date", () => {
    const cov = resolveCoverage(
      workplacePolicy({
        shortTerm: { eliminationDays: 7, benefitPct: 0.6, durationWeeks: 26, monthlyMax: null },
      }),
      SALARY_2028,
      START,
      baseClient,
      2055,
    );
    expect(cov.seam!.kind).toBe("overlap");
    // 26 weeks = 182 days = 5.979466 mo; LTD starts at 2.956879.
    expect(cov.seam!.months).toBeCloseTo(3.022587, 4);
  });

  it("flags an unresolvable benefit period when the insured has no date of birth", () => {
    const noSpouseDob = { ...baseClient, spouseDob: undefined };
    const cov = resolveCoverage(
      workplacePolicy({ insured: "spouse" }),
      SALARY_2028,
      START,
      noSpouseDob,
      2055,
    );
    expect(cov.unresolved).toBe("missing_dob");
    expect(cov.longTerm).toBeNull();
  });
});

describe("benefitForYear", () => {
  const cov = resolveCoverage(workplacePolicy(), SALARY_2028, START, baseClient, 2055);

  it("pays the elimination period, STD, and the LTD switch in the first year", () => {
    // 2.75975 mo STD + 9.04312 mo LTD, both at $7,956.75/mo.
    expect(benefitForYear(cov, START, 2028, 0)).toBeCloseTo(93_912.52, 2);
  });

  it("pays twelve full LTD months in the second year", () => {
    expect(benefitForYear(cov, START, 2029, 0)).toBeCloseTo(95_481.0, 2);
  });

  it("pays nothing before the disability starts", () => {
    expect(benefitForYear(cov, START, 2027, 0)).toBe(0);
  });

  it("stops the year the benefit period ends", () => {
    expect(benefitForYear(cov, START, 2034, 0)).toBeCloseTo(95_481.0, 2);
    expect(benefitForYear(cov, START, 2035, 0)).toBe(0);
  });

  it("does not apply COLA in the first year, and compounds it after", () => {
    expect(benefitForYear(cov, START, 2028, 0.03)).toBeCloseTo(93_912.52, 2);
    expect(benefitForYear(cov, START, 2029, 0.03)).toBeCloseTo(95_481.0 * 1.03, 2);
  });

  it("compounds COLA on the CAPPED benefit, not the uncapped one", () => {
    const capped = resolveCoverage(workplacePolicy(), 424_360, START, baseClient, 2055);
    // $10,000/mo cap × 12 months × 1.03 — NOT $21,218 × 12 × 1.03 capped after.
    expect(benefitForYear(capped, START, 2029, 0.03)).toBeCloseTo(120_000 * 1.03, 2);
  });

  it("pays exactly 60 months for a five-year benefit period", () => {
    const fiveYear = resolveCoverage(
      workplacePolicy({
        shortTerm: null,
        longTerm: {
          eliminationDays: 0,
          benefitPct: 0.6,
          monthlyMax: null,
          benefitPeriod: { mode: "years", years: 5 },
        },
      }),
      SALARY_2028,
      START,
      baseClient,
      2055,
    );
    let total = 0;
    for (let y = 2028; y <= 2040; y++) total += benefitForYear(fiveYear, START, y, 0);
    expect(total).toBeCloseTo(60 * (SALARY_2028 * 0.6 / 12), 2);
  });

  it("runs a lifetime benefit period to the last plan year and stops there", () => {
    const lifetime = resolveCoverage(
      workplacePolicy({
        shortTerm: null,
        longTerm: {
          eliminationDays: 90,
          benefitPct: 0.6,
          monthlyMax: null,
          benefitPeriod: { mode: "lifetime" },
        },
      }),
      SALARY_2028,
      START,
      baseClient,
      2055,
    );
    // 2028..2055 inclusive is 28 plan years => 336 months from the disability.
    expect(lifetime.longTerm!.endMonth).toBe(336);
    expect(benefitForYear(lifetime, START, 2055, 0)).toBeCloseTo(95_481.0, 2);
    expect(benefitForYear(lifetime, START, 2056, 0)).toBe(0);
  });
});

describe("synthesizeDisabilityBenefits", () => {
  const input = {
    incomesBeforeClip: sampleIncomes,
    event: { person: "client" as const, startYear: START },
    policies: [workplacePolicy()],
    client: baseClient,
    planStartYear: basePlanSettings.planStartYear,
    planEndYear: basePlanSettings.planEndYear,
    inflationRate: basePlanSettings.inflationRate,
  };

  it("reads covered earnings from the PRE-CLIP salary", () => {
    // The whole feature fails silently if earnings are read after
    // applyDisabilityEvent has clipped the paycheck — the benefit would be $0
    // and a row would still exist. Assert the DOLLARS, not the row's presence.
    const [row] = synthesizeDisabilityBenefits(input);
    expect(row.scheduleOverrides![2028]).toBeCloseTo(93_912.52, 2);
  });

  it("emits a tax-free row when the insured paid the premium", () => {
    const [row] = synthesizeDisabilityBenefits({
      ...input,
      policies: [workplacePolicy({ benefitTaxable: false })],
    });
    expect(row.taxType).toBe("tax_exempt");
  });

  it("emits an ordinary-income row — never earned_income — when taxable", () => {
    const [row] = synthesizeDisabilityBenefits(input);
    expect(row.taxType).toBe("ordinary_income");
  });

  it("returns nothing when the stress test is off", () => {
    expect(synthesizeDisabilityBenefits({ ...input, event: undefined })).toEqual([]);
  });

  it("ignores policies insuring the other person", () => {
    const out = synthesizeDisabilityBenefits({
      ...input,
      policies: [workplacePolicy({ insured: "spouse" })],
    });
    expect(out).toEqual([]);
  });

  it("sums two policies covering the same person into two rows", () => {
    const out = synthesizeDisabilityBenefits({
      ...input,
      policies: [workplacePolicy(), workplacePolicy({ id: "dp-2", name: "Individual LTD" })],
    });
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.sourceDisabilityPolicyId)).toEqual(["dp-work", "dp-2"]);
  });

  it("grows a manual covered-earnings figure from today's dollars to the start year", () => {
    const [row] = synthesizeDisabilityBenefits({
      ...input,
      policies: [
        workplacePolicy({ coveredEarningsMode: "manual", coveredEarningsAmount: 100_000 }),
      ],
    });
    // 100,000 grown 2026 -> 2028 at 3% = 106,090; 60% / 12 = $5,304.50/mo.
    const monthly = 100_000 * 1.03 ** 2 * 0.6 / 12;
    expect(row.scheduleOverrides![2029]).toBeCloseTo(monthly * 12, 2);
  });
});
