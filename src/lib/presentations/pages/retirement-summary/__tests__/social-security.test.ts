import { describe, it, expect } from "vitest";
import type { ClientData, Income } from "@/engine/types";
import { buildSocialSecurity } from "../social-security";

function ssIncome(over: Partial<Income>): Income {
  return {
    id: "ss1", type: "social_security", owner: "client", name: "Social Security",
    ssBenefitMode: "pia_at_fra", piaMonthly: 2800, claimingAge: 67, claimingAgeMonths: 0, claimingAgeMode: "years",
    growthRate: 0.025, startYear: 2031, endYear: 2099,
    ...over,
  } as unknown as Income;
}
function cd(over: Partial<ClientData>): ClientData {
  return {
    client: { dateOfBirth: "1964-01-01", retirementAge: 67, spouseDob: null, spouseRetirementAge: null },
    incomes: [],
    ...over,
  } as unknown as ClientData;
}

describe("buildSocialSecurity", () => {
  it("builds a 62–70 ladder and flags the selected claim age (single client)", () => {
    const data = cd({ incomes: [ssIncome({})] });
    const res = buildSocialSecurity(data, /* nowYear */ 2026);
    expect(res.spouse).toBeNull();
    expect(res.client).not.toBeNull();
    const c = res.client!;
    expect(c.piaMonthly).toBe(2800);
    expect(c.colaPct).toBeCloseTo(0.025);
    expect(c.alreadyClaiming).toBe(false);
    expect(c.ladder.map((r) => r.age)).toEqual([62, 63, 64, 65, 66, 67, 68, 69, 70]);
    const selected = c.ladder.filter((r) => r.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0].age).toBe(67);
    // FRA claim (born 1964, FRA 67) returns PIA unchanged at age 67.
    expect(Math.round(selected[0].monthly)).toBe(2800);
  });

  it("starts the ladder at current age when past 62", () => {
    const data = cd({
      client: { dateOfBirth: "1962-01-01", retirementAge: 67, spouseDob: null, spouseRetirementAge: null } as never,
      incomes: [ssIncome({})],
    });
    const res = buildSocialSecurity(data, 2026); // age 64 in 2026
    expect(res.client!.ladder[0].age).toBe(64);
    expect(res.client!.ladder.at(-1)!.age).toBe(70);
  });

  it("collapses to received amount when already past the claim age", () => {
    const data = cd({
      client: { dateOfBirth: "1955-01-01", retirementAge: 66, spouseDob: null, spouseRetirementAge: null } as never,
      incomes: [ssIncome({ claimingAge: 66 })],
    });
    const res = buildSocialSecurity(data, 2026); // age 71 — already claiming
    expect(res.client!.alreadyClaiming).toBe(true);
    expect(res.client!.ladder).toHaveLength(0);
    expect(res.client!.receivedMonthly).not.toBeNull();
  });

  it("returns null when there is no SS income", () => {
    expect(buildSocialSecurity(cd({ incomes: [] }), 2026).client).toBeNull();
  });

  it("returns null when PIA is zero", () => {
    expect(buildSocialSecurity(cd({ incomes: [ssIncome({ piaMonthly: 0 })] }), 2026).client).toBeNull();
  });

  it("builds a Co-client column when a Co-client SS income exists", () => {
    const data = cd({
      client: { dateOfBirth: "1964-01-01", retirementAge: 67, spouseDob: "1965-01-01", spouseRetirementAge: 70 } as never,
      incomes: [ssIncome({}), ssIncome({ id: "ss2", owner: "spouse", piaMonthly: 2100, claimingAge: 70 })],
    });
    const res = buildSocialSecurity(data, 2026);
    expect(res.spouse).not.toBeNull();
    expect(res.spouse!.piaMonthly).toBe(2100);
    expect(res.spouse!.ladder.find((r) => r.selected)!.age).toBe(70);
  });

  it("builds a ladder for a benefit stated at an age, off the PIA it implies", () => {
    // Paul: born 1958-02-24 (FRA 66y8mo). $68,478/yr claimed at 70 is
    // 5706.50/mo ÷ 1.26667 (40 months of 2/3% credits) = a PIA of 4505.13.
    const data = cd({
      client: { dateOfBirth: "1958-02-24", retirementAge: 70, spouseDob: null, spouseRetirementAge: null } as never,
      incomes: [ssIncome({
        ssBenefitMode: "manual_amount", piaMonthly: undefined, annualAmount: 68478, claimingAge: 70,
      })],
    });
    const c = buildSocialSecurity(data, 2026).client!;
    expect(c).not.toBeNull();
    expect(c.piaMonthly).toBeCloseTo(4505.13, 1);
    expect(c.ladder.find((r) => r.age === 70)!.monthly).toBeCloseTo(5706.5, 1);
    expect(c.ladder.find((r) => r.selected)!.age).toBe(70);
  });
});
