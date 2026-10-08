import { describe, expect, it } from "vitest";
import {
  answeredSocialSecurity,
  socialSecurityAnswerLabel,
  ssAnswerFromRow,
  ssBenefitPatch,
} from "@/lib/intake/social-security";

describe("socialSecurityAnswerLabel", () => {
  it("joins the benefit and the start age", () => {
    expect(socialSecurityAnswerLabel({ piaMonthly: 2800, claimingAge: 67 })).toBe(
      "$2,800/mo at FRA · start at 67",
    );
  });

  it("names the age the benefit is quoted at when it is not full retirement age", () => {
    expect(
      socialSecurityAnswerLabel({ piaMonthly: 5706.5, benefitAge: 70, claimingAge: 70 }),
    ).toBe("$5,707/mo at 70 · start at 70");
  });

  it("reads either half alone", () => {
    expect(socialSecurityAnswerLabel({ piaMonthly: 1950.4 })).toBe("$1,950/mo at FRA");
    expect(socialSecurityAnswerLabel({ claimingAge: 62 })).toBe("Start at 62");
  });

  it("is null for no answer — a $0 benefit included", () => {
    expect(socialSecurityAnswerLabel(undefined)).toBeNull();
    expect(socialSecurityAnswerLabel({})).toBeNull();
    expect(socialSecurityAnswerLabel({ piaMonthly: 0 })).toBeNull();
  });
});

describe("answeredSocialSecurity", () => {
  const ss = { client: { claimingAge: 67 }, spouse: { piaMonthly: 2000 } };

  it("names each person who answered, client first", () => {
    const family = { primary: { firstName: "Jane" }, spouse: { firstName: "John" } };
    expect(answeredSocialSecurity(ss, family)).toEqual([
      { owner: "client", name: "Jane", label: "Start at 67" },
      { owner: "spouse", name: "John", label: "$2,000/mo at FRA" },
    ]);
  });

  it("drops a co-client answer when the form has no co-client", () => {
    expect(answeredSocialSecurity(ss, { primary: { firstName: "Jane" }, spouse: null })).toEqual([
      { owner: "client", name: "Jane", label: "Start at 67" },
    ]);
  });

  it("falls back to role words when no names were collected", () => {
    expect(
      answeredSocialSecurity(ss, { spouse: {} }).map((r) => r.name),
    ).toEqual(["Client", "Co-client"]);
  });
});

describe("ssBenefitPatch / ssAnswerFromRow", () => {
  const base = {
    piaMonthly: null,
    annualAmount: null,
    ssBenefitMode: null,
    ssStatedAge: null,
    ssStatedAgeMonths: null,
    ssAmountUnit: null,
    claimingAge: null,
    claimingAgeMonths: null,
    claimingAgeMode: null,
  };

  it("round-trips a monthly benefit quoted at 70", () => {
    const patch = ssBenefitPatch(5706.5, 70);
    expect(patch).toEqual({
      ssBenefitMode: "manual_amount",
      annualAmount: "68478",
      piaMonthly: null,
      ssStatedAge: 70,
      ssStatedAgeMonths: 0,
      ssAmountUnit: "monthly",
    });
    // The DB hands the decimal back with its scale.
    expect(ssAnswerFromRow({ ...base, ...patch, annualAmount: "68478.00" })).toEqual({
      piaMonthly: 5706.5,
      benefitAge: 70,
    });
  });

  it("reads a yearly-unit or NULL-unit stated row as 'Not sure'", () => {
    const stated = {
      ...base,
      ssBenefitMode: "manual_amount",
      annualAmount: "41000.00",
      ssStatedAge: 70,
      ssStatedAgeMonths: 0,
    };
    expect(ssAnswerFromRow({ ...stated, ssAmountUnit: "annual" })).toEqual({});
    expect(ssAnswerFromRow({ ...stated, ssAmountUnit: null })).toEqual({});
  });

  it("reads a stated age that is not a whole year as 'Not sure'", () => {
    expect(
      ssAnswerFromRow({
        ...base,
        ssBenefitMode: "manual_amount",
        annualAmount: "68478.00",
        ssStatedAge: 70,
        ssStatedAgeMonths: 6,
        ssAmountUnit: "monthly",
      }),
    ).toEqual({});
  });

  it("writes a full-retirement-age figure as a PIA and clears any stated age", () => {
    expect(ssBenefitPatch(2800, undefined)).toEqual({
      piaMonthly: "2800",
      ssBenefitMode: "pia_at_fra",
      ssStatedAge: null,
      ssStatedAgeMonths: null,
    });
    expect(ssBenefitPatch(undefined, 70)).toEqual({});
  });

  it("still reads a FRA PIA row back as its benefit", () => {
    expect(
      ssAnswerFromRow({ ...base, piaMonthly: "2800.00", ssBenefitMode: "pia_at_fra" }),
    ).toEqual({ piaMonthly: 2800 });
  });
});
