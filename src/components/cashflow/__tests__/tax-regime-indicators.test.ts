import { describe, it, expect } from "vitest";
import { detectRegimeTransitions, regimeTooltip } from "../tax-regime-indicators";
import type { ProjectionYear } from "@/engine";

function makeYear(overrides: Partial<{
  year: number;
  amtAdditional: number;
  niit: number;
  additionalMedicare: number;
  fica: number;
  marginalRate: number;
}> = {}): ProjectionYear {
  const {
    year = 2026,
    amtAdditional = 0,
    niit = 0,
    additionalMedicare = 0,
    fica = 0,
    marginalRate = 0.22,
  } = overrides;
  return {
    year,
    ages: { client: 60 },
    income: { salaries: 0, socialSecurity: 0, business: 0, trust: 0, deferred: 0, capitalGains: 0, other: 0, total: 0, bySource: {} },
    withdrawals: { byAccount: {}, total: 0 },
    expenses: { living: 0, liabilities: 0, other: 0, insurance: 0, taxes: 0, total: 0, bySource: {} },
    savings: { byAccount: {}, total: 0 },
    accountBalances: {},
    netWorth: 0,
    netCashFlow: 0,
    taxResult: {
      income: {
        earnedIncome: 0, taxableSocialSecurity: 0, ordinaryIncome: 0,
        dividends: 0, capitalGains: 0, shortCapitalGains: 0,
        totalIncome: 0, nonTaxableIncome: 0, grossTotalIncome: 0,
      },
      flow: {
        aboveLineDeductions: 0, adjustedGrossIncome: 0, qbiDeduction: 0,
        belowLineDeductions: 0, taxableIncome: 0, incomeTaxBase: 0,
        regularTaxCalc: 0, amtCredit: 0, taxCredits: 0, refundableCredits: 0,
        regularFederalIncomeTax: 0, capitalGainsTax: 0,
        amtAdditional, niit, additionalMedicare, fica,
        stateTax: 0, totalFederalTax: 0, totalTax: 0,
      },
      diag: {
        marginalFederalRate: marginalRate,
        effectiveFederalRate: 0,
        bracketsUsed: {} as never,
        inflationFactor: 1,
      },
    },
  } as unknown as ProjectionYear;
}

describe("detectRegimeTransitions", () => {
  it("returns empty map for empty projection", () => {
    expect(detectRegimeTransitions([])).toEqual({});
  });

  // The year-over-year detectors still need a prior year. AMT deliberately no
  // longer does: a client already in AMT in year one is the single most common
  // AMT client there is, and the old "empty map" here was the bug (F20).
  it("a single-year projection still produces no year-over-year transitions", () => {
    const result = detectRegimeTransitions([makeYear({ year: 2026, niit: 500, fica: 0 })]);
    expect(result).toEqual({});
  });

  it("but a single-year projection in AMT is flagged", () => {
    const result = detectRegimeTransitions([makeYear({ year: 2026, amtAdditional: 1000 })]);
    expect(result[2026]).toEqual(["amt_first_year"]);
  });

  it("returns empty map when all years look the same", () => {
    const years = [
      makeYear({ year: 2026, fica: 5000 }),
      makeYear({ year: 2027, fica: 5000 }),
      makeYear({ year: 2028, fica: 5000 }),
    ];
    expect(detectRegimeTransitions(years)).toEqual({});
  });

  it("detects first year AMT adds", () => {
    const years = [
      makeYear({ year: 2026, amtAdditional: 0 }),
      makeYear({ year: 2027, amtAdditional: 500 }),
      makeYear({ year: 2028, amtAdditional: 1200 }),
    ];
    const result = detectRegimeTransitions(years);
    expect(result[2027]).toContain("amt_first_year");
    expect(result[2028]).toBeUndefined();
  });

  it("detects first year NIIT applies", () => {
    const years = [
      makeYear({ year: 2026, niit: 0 }),
      makeYear({ year: 2027, niit: 2000 }),
    ];
    expect(detectRegimeTransitions(years)[2027]).toContain("niit_first_year");
  });

  it("detects first year additional Medicare applies", () => {
    const years = [
      makeYear({ year: 2026, additionalMedicare: 0 }),
      makeYear({ year: 2027, additionalMedicare: 450 }),
    ];
    expect(detectRegimeTransitions(years)[2027]).toContain("addl_medicare_first_year");
  });

  it("detects retirement (FICA drops to 0)", () => {
    const years = [
      makeYear({ year: 2026, fica: 5000 }),
      makeYear({ year: 2027, fica: 0 }),
    ];
    expect(detectRegimeTransitions(years)[2027]).toContain("retirement_fica_zero");
  });

  it("detects marginal rate jump of 5+ percentage points (upward only)", () => {
    const years = [
      makeYear({ year: 2026, marginalRate: 0.22 }),
      makeYear({ year: 2027, marginalRate: 0.32 }), // +10pts
      makeYear({ year: 2028, marginalRate: 0.24 }), // -8pts, should not trigger (downward)
    ];
    const result = detectRegimeTransitions(years);
    expect(result[2027]).toContain("marginal_rate_jump");
    expect(result[2028]).toBeUndefined();
  });

  it("does not trigger marginal rate jump for <5pt increases", () => {
    const years = [
      makeYear({ year: 2026, marginalRate: 0.22 }),
      makeYear({ year: 2027, marginalRate: 0.24 }), // +2pts
    ];
    expect(detectRegimeTransitions(years)[2027]).toBeUndefined();
  });

  it("records multiple transitions for the same year", () => {
    const years = [
      makeYear({ year: 2026, amtAdditional: 0, niit: 0 }),
      makeYear({ year: 2027, amtAdditional: 1000, niit: 500 }),
    ];
    const transitions = detectRegimeTransitions(years)[2027];
    expect(transitions).toContain("amt_first_year");
    expect(transitions).toContain("niit_first_year");
    expect(transitions).toHaveLength(2);
  });

  it("does not re-trigger amt_first_year on subsequent AMT years", () => {
    const years = [
      makeYear({ year: 2026, amtAdditional: 0 }),
      makeYear({ year: 2027, amtAdditional: 500 }),
      makeYear({ year: 2028, amtAdditional: 800 }),
      makeYear({ year: 2029, amtAdditional: 1200 }),
    ];
    const result = detectRegimeTransitions(years);
    expect(result[2027]).toContain("amt_first_year");
    expect(result[2028]).toBeUndefined();
    expect(result[2029]).toBeUndefined();
  });

  it("handles years without taxResult (defensive)", () => {
    const years: ProjectionYear[] = [
      makeYear({ year: 2026, fica: 5000 }),
      { ...makeYear({ year: 2027 }), taxResult: undefined } as ProjectionYear,
      makeYear({ year: 2028, fica: 5000 }),
    ];
    // Should not crash; missing taxResult = no transitions detected
    expect(() => detectRegimeTransitions(years)).not.toThrow();
  });
});

// ── F20 — the amber AMT marker told every client "high AGI" ──────────────────
// For an option client the driver is the bargain element and the AGI on the
// same row is often small, so the advisor reads it as a data-entry error. And
// the detector started at the SECOND year, so a January option exercise in the
// current year was never flagged at all.

function amtYear(over: {
  year: number; amtAdditional: number; amti?: number; isoSpread?: number;
}): ProjectionYear {
  const y = makeYear({ year: over.year, amtAdditional: over.amtAdditional });
  (y.taxResult!.diag as { amti?: number }).amti = over.amti;
  if (over.isoSpread != null) {
    (y as { equityTaxImpact?: { isoSpread: number } }).equityTaxImpact = {
      isoSpread: over.isoSpread,
    } as ProjectionYear["equityTaxImpact"];
  }
  return y;
}

describe("detectRegimeTransitions — AMT in the projection's first year (F20)", () => {
  it("flags AMT in year one, which the old second-year loop could never see", () => {
    const years = [amtYear({ year: 2026, amtAdditional: 196_899, amti: 760_000, isoSpread: 700_000 })];
    expect(detectRegimeTransitions(years)[2026]).toContain("amt_first_year");
  });

  it("does not re-flag the years after a spell that started in year one", () => {
    const years = [
      amtYear({ year: 2026, amtAdditional: 196_899 }),
      amtYear({ year: 2027, amtAdditional: 120_000 }),
    ];
    const result = detectRegimeTransitions(years);
    expect(result[2026]).toContain("amt_first_year");
    expect(result[2027]).toBeUndefined();
  });

  it("still does not flag a year-one client with no AMT", () => {
    expect(detectRegimeTransitions([amtYear({ year: 2026, amtAdditional: 0 })])[2026]).toBeUndefined();
  });

  it("ignores a sub-dollar excess in year one (shares the F37 gate)", () => {
    expect(detectRegimeTransitions([amtYear({ year: 2026, amtAdditional: 0.4 })])[2026]).toBeUndefined();
  });
});

describe("regimeTooltip — naming the driver that actually caused the AMT (F20)", () => {
  // A quiet prior year, so the tooltip is entitled to say "first year".
  const prior = makeYear({ year: 2025 });

  it("names the option exercise, not AGI, when a bargain element is the driver", () => {
    const y = amtYear({ year: 2026, amtAdditional: 196_899, amti: 760_000, isoSpread: 700_000 });
    const t = regimeTooltip([prior, y], y, ["amt_first_year"]);
    expect(t).toContain("option");
    expect(t).toContain("$700,000");
    expect(t).not.toContain("AGI");
  });

  it("keeps the exemption phase-out as a real cause for a gains-heavy client with no options", () => {
    const y = amtYear({ year: 2026, amtAdditional: 18_360, amti: 2_060_000 });
    const t = regimeTooltip([prior, y], y, ["amt_first_year"]);
    expect(t).toContain("exemption");
    expect(t).toContain("$2,060,000");
    expect(t).not.toContain("option");
  });

  it("says 'AMT income', never 'AGI' — the two differ by a factor of twelve here", () => {
    const y = amtYear({ year: 2026, amtAdditional: 196_899, amti: 760_000, isoSpread: 700_000 });
    expect(regimeTooltip([prior, y], y, ["amt_first_year"])).toContain("AMT income");
  });

  it("does not claim 'first year' when there is no prior year to compare", () => {
    const y = amtYear({ year: 2026, amtAdditional: 196_899, amti: 760_000, isoSpread: 700_000 });
    expect(regimeTooltip([y], y, ["amt_first_year"]).toLowerCase()).not.toContain("first year");
  });

  it("does say 'first year' when the prior year genuinely had none", () => {
    const y = amtYear({ year: 2027, amtAdditional: 196_899, amti: 760_000 });
    expect(regimeTooltip([prior, y], y, ["amt_first_year"]).toLowerCase()).toContain("first year");
  });

  it("still returns the static copy for the non-AMT transitions", () => {
    const y = makeYear({ year: 2027, niit: 500 });
    expect(regimeTooltip([prior, y], y, ["niit_first_year"])).toContain("NIIT");
  });

  it("joins several transitions onto their own lines", () => {
    const y = amtYear({ year: 2027, amtAdditional: 1000, amti: 900_000 });
    const t = regimeTooltip([prior, y], y, ["amt_first_year", "niit_first_year"]);
    expect(t.split("\n")).toHaveLength(2);
  });
});

describe("detectRegimeTransitions — partially-built years", () => {
  // Inspecting year zero brings half-built fixtures into reach that the old
  // second-year start silently skipped. The three tax detail tables render
  // exactly such fixtures, so this must not throw.
  it("skips a year whose taxResult carries no flow", () => {
    const bare = { year: 2026, ages: { client: 60 }, taxResult: {} } as unknown as ProjectionYear;
    expect(() => detectRegimeTransitions([bare])).not.toThrow();
    expect(detectRegimeTransitions([bare])).toEqual({});
  });

  it("still flags a good year that follows a flowless one", () => {
    const bare = { year: 2026, ages: { client: 60 }, taxResult: {} } as unknown as ProjectionYear;
    const good = makeYear({ year: 2027, amtAdditional: 5_000 });
    expect(detectRegimeTransitions([bare, good])[2027]).toContain("amt_first_year");
  });
});
