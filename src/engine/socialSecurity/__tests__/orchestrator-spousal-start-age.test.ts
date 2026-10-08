// src/engine/socialSecurity/__tests__/orchestrator-spousal-start-age.test.ts
import { describe, it, expect } from "vitest";
import { resolveAnnualBenefit } from "../orchestrator";
import type { Income, ClientInfo } from "../../types";

// Worker b. 1960-06-15 (FRA 67 = June 2027) files own at 62 → entitled JULY 2022
// (mid-month birth: must be 62 throughout the month) → 59 months early on OWN.
// Spouse b. 1962-06-15 files at 64 → entitled June 2026, when the worker is 66y0m
// → the SPOUSAL part is 12 months early, not 59.
const client: ClientInfo = {
  firstName: "A", lastName: "B", dateOfBirth: "1960-06-15",
  retirementAge: 62, planEndAge: 95, filingStatus: "married_joint",
  spouseDob: "1962-06-15", spouseLifeExpectancy: 90, lifeExpectancy: 90,
};
const row = (o: Partial<Income>): Income => ({
  id: "x", type: "social_security", name: "SS", annualAmount: 0,
  startYear: 2020, endYear: 2099, growthRate: 0, inflationStartYear: 2020,
  owner: "client", claimingAgeMonths: 0, claimingAgeMode: "years",
  ssBenefitMode: "pia_at_fra", ...o,
});

describe("spousal reduction is priced at the SPOUSAL start", () => {
  it("own at 62, spousal from 66 → spousal reduced 12 months, own 59", () => {
    const worker = row({ id: "w", owner: "client", piaMonthly: 300, claimingAge: 62 });
    const spouse = row({ id: "s", owner: "spouse", piaMonthly: 2400, claimingAge: 64 });
    const out = resolveAnnualBenefit({ row: worker, spouseRow: spouse, client, year: 2027 });

    const own = 300 * (1 - 36 * (5 / 900) - 23 * (5 / 1200)); // 211.25
    const spousal = 1200 * (1 - 12 * (25 / 3600));           // 1100.00
    expect(out.retirement).toBeCloseTo(own * 12, 2);           // 2535
    expect(out.spousal).toBeCloseTo((spousal - own) * 12, 2);  // 10665 (was 6885)
  });

  it("no change when both file at or after FRA", () => {
    const worker = row({ id: "w", owner: "client", piaMonthly: 300, claimingAge: 67 });
    const spouse = row({ id: "s", owner: "spouse", piaMonthly: 2400, claimingAge: 67 });
    const out = resolveAnnualBenefit({ row: worker, spouseRow: spouse, client, year: 2030 });
    expect(out.spousal).toBeCloseTo((1200 - 300) * 12, 2);
  });
});
