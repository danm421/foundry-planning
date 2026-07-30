// src/lib/household-map/__tests__/social-security.test.ts
import { describe, it, expect } from "vitest";
import { isSocialSecurityIncome, ssStartNote } from "../social-security";
import type { ClientInfo, Income } from "@/engine/types";

const CLIENT: ClientInfo = {
  firstName: "Cooper",
  lastName: "Reid",
  // 1970 birth year throughout, so every expected year below is `1970 + age`.
  dateOfBirth: "1970-04-02",
  retirementAge: 65,
  planEndAge: 95,
  spouseName: "Dana",
  spouseDob: "1975-09-14",
  spouseRetirementAge: 63,
  filingStatus: "married_joint",
};

function ssRow(over: Partial<Income> = {}): Income {
  return {
    id: "ss-1",
    type: "social_security",
    name: "Cooper's Social Security",
    annualAmount: 0,
    startYear: 2026,
    endYear: 2099,
    growthRate: 0.02,
    owner: "client",
    ssBenefitMode: "pia_at_fra",
    piaMonthly: 2800,
    claimingAgeMode: "years",
    claimingAge: 70,
    claimingAgeMonths: 0,
    ...over,
  } as Income;
}

describe("isSocialSecurityIncome", () => {
  it("is true only for the social_security type", () => {
    expect(isSocialSecurityIncome({ type: "social_security" })).toBe(true);
    expect(isSocialSecurityIncome({ type: "salary" })).toBe(false);
    expect(isSocialSecurityIncome({ type: "deferred" })).toBe(false);
  });
});

describe("ssStartNote", () => {
  it("names the claim age for a benefit that has not started", () => {
    // Claims at 70 → first benefit year 2040, well past a 2026 plan start.
    expect(ssStartNote(ssRow(), CLIENT, 2026)).toEqual({
      label: "at 70",
      title: "Benefit starts at age 70 (2040)",
    });
  });

  it("includes months when the claim age carries them", () => {
    const note = ssStartNote(ssRow({ claimingAge: 67, claimingAgeMonths: 6 }), CLIENT, 2026);
    expect(note?.label).toBe("at 67y 6mo");
    // 67y 6mo first pays at 68 — the engine compares WHOLE years of age, so a
    // mid-year claim age lands the year after. A title reading 2037 would be the
    // bug this pins.
    expect(note?.title).toBe("Benefit starts at age 67y 6mo (2038)");
  });

  it("resolves fra mode off the owner's date of birth", () => {
    // FRA for a 1970 birth year is 67y 0mo.
    expect(ssStartNote(ssRow({ claimingAgeMode: "fra" }), CLIENT, 2026)?.label).toBe("at 67");
  });

  it("resolves at_retirement mode off the owner's retirement age", () => {
    expect(ssStartNote(ssRow({ claimingAgeMode: "at_retirement" }), CLIENT, 2026)?.label).toBe(
      "at 65",
    );
  });

  it("reads the SPOUSE's dob and retirement age for a spouse-owned row", () => {
    // Dana retires at 63, not Cooper's 65 — reading the wrong side of the
    // household is the failure this pins. Born 1975, so 1975 + 63 = 2038.
    const note = ssStartNote(
      ssRow({ owner: "spouse", claimingAgeMode: "at_retirement" }),
      CLIENT,
      2026,
    );
    expect(note).toEqual({ label: "at 63", title: "Benefit starts at age 63 (2038)" });
  });

  it("falls back to the year range once the benefit is already in payment", () => {
    // Claiming at 70 = 2040. A plan starting in 2041 is paying it already, so
    // the window is real and "at 70" would read as a plan rather than a fact.
    expect(ssStartNote(ssRow(), CLIENT, 2041)).toBeNull();
  });

  it("treats the claim year ITSELF as started", () => {
    // The engine pays in the first year age >= claim age (`hasClaimed` in
    // socialSecurity/orchestrator.ts), so 2040 is a paying year, not a pending one.
    expect(ssStartNote(ssRow(), CLIENT, 2040)).toBeNull();
  });

  it("says so when the row is set to no benefit", () => {
    // `engine/income.ts` skips these rows outright. A claim age would promise
    // money the projection never pays.
    expect(ssStartNote(ssRow({ ssBenefitMode: "no_benefit" }), CLIENT, 2026)?.label).toBe(
      "no benefit",
    );
  });

  it("says so even when the no-benefit row's claim age resolves fine", () => {
    // The `no_benefit` check has to come FIRST — this row carries a complete,
    // resolvable claim age and would otherwise render "at 70".
    expect(
      ssStartNote(
        ssRow({ ssBenefitMode: "no_benefit", claimingAgeMode: "years", claimingAge: 70 }),
        CLIENT,
        2026,
      )?.label,
    ).toBe("no benefit");
  });

  it("returns null when the claim age cannot be resolved", () => {
    // `at_retirement` for a spouse with no retirement age — `resolveClaimAgeMonths`
    // returns null and the engine emits nothing.
    const noSpouseRetirement: ClientInfo = { ...CLIENT, spouseRetirementAge: undefined };
    expect(
      ssStartNote(
        ssRow({ owner: "spouse", claimingAgeMode: "at_retirement" }),
        noSpouseRetirement,
        2026,
      ),
    ).toBeNull();
  });

  it("returns null when the owner has no date of birth", () => {
    const noSpouseDob: ClientInfo = { ...CLIENT, spouseDob: undefined };
    expect(ssStartNote(ssRow({ owner: "spouse" }), noSpouseDob, 2026)).toBeNull();
  });

  it("returns null for a non-social-security income", () => {
    expect(ssStartNote(ssRow({ type: "salary" }), CLIENT, 2026)).toBeNull();
  });
});
