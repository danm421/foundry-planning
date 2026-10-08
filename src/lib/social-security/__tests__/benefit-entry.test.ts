// src/lib/social-security/__tests__/benefit-entry.test.ts
import { describe, it, expect } from "vitest";
import type { Income, ClientInfo } from "@/engine/types";
import {
  asSsIncome, otherSsRow, entryUnit, toMonthly, toAnnual, convertAmountText,
  initialEntryAmount, initialStatedAge, statedAgeYear, ageLabel, ssEntryLabel, ssEntryPreview,
} from "../benefit-entry";

const douglas: ClientInfo = {
  firstName: "Paul", lastName: "Douglas", dateOfBirth: "1958-02-24",
  retirementAge: 70, planEndAge: 97, filingStatus: "married_joint",
  spouseDob: "1960-07-16", spouseName: "Cynthia", spouseLifeExpectancy: 95, lifeExpectancy: 95,
} as ClientInfo;

const paul = {
  id: "p", type: "social_security", name: "SS", annualAmount: 68478, startYear: 2026, endYear: 2099,
  growthRate: 0.02, owner: "client", claimingAge: 70, claimingAgeMonths: 0, claimingAgeMode: "years",
  ssBenefitMode: "manual_amount",
} as Income;

describe("units", () => {
  it("defaults: a PIA reads monthly, a stated benefit annually; a stored unit wins", () => {
    expect(entryUnit({ ssBenefitMode: "pia_at_fra" })).toBe("monthly");
    expect(entryUnit({ ssBenefitMode: "manual_amount" })).toBe("annual");
    expect(entryUnit({ ssBenefitMode: "manual_amount", ssAmountUnit: "monthly" })).toBe("monthly");
    expect(entryUnit(null)).toBe("annual");
  });
  it("converts", () => {
    expect(toMonthly(68478, "annual")).toBeCloseTo(5706.5, 9);
    expect(toAnnual(5706.5, "monthly")).toBe(68478);
    expect(convertAmountText("68478", "annual", "monthly")).toBe("5706.5");
    expect(convertAmountText("5706.5", "monthly", "annual")).toBe("68478");
    expect(convertAmountText("", "annual", "monthly")).toBe("");
  });
});

describe("opening an existing row", () => {
  it("a legacy stated row opens annual, at its claim age", () => {
    expect(initialEntryAmount(paul)).toBe("68478");
    expect(initialStatedAge(paul, douglas)).toEqual({ years: 70, months: 0 });
  });
  it("REVIEW FOCUS 1 — typed monthly, reopened monthly, with no float noise", () => {
    const typed = { ...paul, annualAmount: 68478, ssAmountUnit: "monthly", ssStatedAge: 70 } as Income;
    expect(initialEntryAmount(typed)).toBe("5706.5");
  });
  it("a PIA typed annually reopens annually", () => {
    const pia = { ...paul, ssBenefitMode: "pia_at_fra", piaMonthly: 4500, ssAmountUnit: "annual" } as Income;
    expect(initialEntryAmount(pia)).toBe("54000");
  });
  it("an FRA-mode claim opens its stated age at FRA (Paul: 66y 8m)", () => {
    const fra = { ...paul, claimingAgeMode: "fra" } as Income;
    expect(initialStatedAge(fra, douglas)).toEqual({ years: 66, months: 8 });
  });
  it("labels the year the stated age falls in", () => {
    expect(statedAgeYear("1958-02-24", 70, 0)).toBe(2028);
    expect(ageLabel(70, 0)).toBe("70");
    expect(ageLabel(66, 8)).toBe("66y 8mo");
  });
});

describe("ssEntryLabel", () => {
  it("shows the entry as typed", () => {
    expect(ssEntryLabel(paul, douglas)).toBe("$68,478/yr at 70");
    expect(ssEntryLabel({ ...paul, ssAmountUnit: "monthly", ssStatedAge: 70 } as Income, douglas)).toBe("$5,707/mo at 70");
    expect(ssEntryLabel({ ...paul, ssBenefitMode: "pia_at_fra", piaMonthly: 4505 } as Income, douglas)).toBe("$4,505/mo PIA");
    expect(ssEntryLabel({ ...paul, ssBenefitMode: "no_benefit" } as Income, douglas)).toBeNull();
  });
});

describe("REVIEW FOCUS 5 — raw rows, single clients, No benefit", () => {
  it("coerces string decimals from list-GET rows", () => {
    const raw = { id: "c", type: "social_security", owner: "spouse", annualAmount: "29016.00", piaMonthly: "0.00",
      growthRate: "0.0200", ssBenefitMode: "pia_at_fra", claimingAge: 67, claimingAgeMode: "fra" };
    const inc = asSsIncome(raw);
    expect(inc.piaMonthly).toBe(0);
    expect(inc.annualAmount).toBe(29016);
    expect(inc.growthRate).toBeCloseTo(0.02, 9);
    expect(otherSsRow([raw], "client")?.id).toBe("c");
    expect(otherSsRow([raw], "spouse")).toBeNull();
  });

  it("preview: PIA, own at the claim age, and Cynthia's top-up off Paul", () => {
    const cynthia = asSsIncome({ id: "c", type: "social_security", owner: "spouse", annualAmount: "0",
      piaMonthly: "0.00", growthRate: "0.02", ssBenefitMode: "pia_at_fra", claimingAge: 67, claimingAgeMode: "fra" });
    const p = ssEntryPreview(paul, cynthia, douglas)!;
    expect(p.piaMonthly).toBeCloseTo(4505.13, 2);
    expect(p.ownAnnual).toBeCloseTo(68478, 2);
    expect(p.topUps.spouse).toBeCloseTo(2252.57, 2);
    expect(p.topUps.client).toBe(0);
    for (const v of [p.piaMonthly, p.ownAnnual, p.topUps.client, p.topUps.spouse]) expect(Number.isNaN(v)).toBe(false);
  });

  it("no spouse row → topUps null, no crash", () => {
    const p = ssEntryPreview(paul, null, douglas)!;
    expect(p.topUps).toEqual({ client: null, spouse: null });
  });

  it("other spouse on No benefit → no top-up line", () => {
    const none = { ...paul, id: "c", owner: "spouse", ssBenefitMode: "no_benefit" } as Income;
    const p = ssEntryPreview(paul, none, douglas)!;
    expect(p.topUps).toEqual({ client: null, spouse: null });
  });

  it("nothing priceable → null", () => {
    expect(ssEntryPreview({ ...paul, ssBenefitMode: "no_benefit" } as Income, null, douglas)).toBeNull();
  });
});
