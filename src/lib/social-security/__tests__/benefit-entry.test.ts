// src/lib/social-security/__tests__/benefit-entry.test.ts
import { describe, it, expect } from "vitest";
import type { Income, ClientInfo } from "@/engine/types";
import {
  asSsIncome, otherSsRow, entryUnit, toMonthly, toAnnual, convertAmountText,
  initialEntryAmount, initialStatedAge, statedAgeYear, ageLabel, ssEntryLabel, ssEntryPreview, ssDraftRow, claimTracksStatedAge,
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
  it("a monthly figure flipped to annual snaps off the cent-rounding noise", () => {
    expect(convertAmountText("3333.33", "monthly", "annual")).toBe("40000");
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
  it("a PIA typed annually reopens as the dollars typed, despite monthly-cents storage", () => {
    // $54,001/yr saves as 4500.08/mo; × 12 = 54000.96, within 6¢ of 54001.
    const snapped = { ...paul, ssBenefitMode: "pia_at_fra", piaMonthly: 4500.08, ssAmountUnit: "annual" } as Income;
    expect(initialEntryAmount(snapped)).toBe("54001");
    // 4500.04 × 12 = 54000.48, not within 6¢ of a dollar: keeps its cents.
    const cents = { ...paul, ssBenefitMode: "pia_at_fra", piaMonthly: 4500.04, ssAmountUnit: "annual" } as Income;
    expect(initialEntryAmount(cents)).toBe("54000.48");
  });
  it("an FRA-mode claim opens its stated age at FRA (Paul: 66y 8m)", () => {
    const fra = { ...paul, claimingAgeMode: "fra" } as Income;
    expect(initialStatedAge(fra, douglas)).toEqual({ years: 66, months: 8 });
  });
  it("a stored stated age outside 62-70 opens clamped, so Save can never send it back", () => {
    expect(initialStatedAge({ ...paul, ssStatedAge: 72, ssStatedAgeMonths: 4 } as Income, douglas)).toEqual({ years: 70, months: 0 });
    expect(initialStatedAge({ ...paul, ssStatedAge: 60, ssStatedAgeMonths: 0 } as Income, douglas)).toEqual({ years: 62, months: 0 });
    expect(initialStatedAge({ ...paul, ssStatedAge: 68, ssStatedAgeMonths: 6 } as Income, douglas)).toEqual({ years: 68, months: 6 });
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
  it("a $0 PIA is a real entry (no work record); an unset PIA is not", () => {
    const pia = { ...paul, ssBenefitMode: "pia_at_fra" } as Income;
    expect(ssEntryLabel({ ...pia, piaMonthly: 0 }, douglas)).toBe("$0/mo PIA");
    expect(ssEntryLabel({ ...pia, piaMonthly: undefined }, douglas)).toBeNull();
    expect(ssEntryLabel({ ...pia, piaMonthly: null } as unknown as Income, douglas)).toBeNull();
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

  it("a blank or $0 benefit-at-age box previews nothing; a $0 PIA is a real answer and does", () => {
    expect(ssEntryPreview({ ...paul, annualAmount: 0 } as Income, null, douglas)).toBeNull();
    const zeroPia = { ...paul, ssBenefitMode: "pia_at_fra", piaMonthly: 0 } as Income;
    expect(ssEntryPreview(zeroPia, null, douglas)?.piaMonthly).toBe(0);
  });

  it("carries the other row's resolved PIA (null with no other row)", () => {
    const cynthia = { ...paul, id: "c", owner: "spouse", ssBenefitMode: "pia_at_fra", piaMonthly: 1778 } as Income;
    expect(ssEntryPreview(paul, cynthia, douglas)!.otherPiaMonthly).toBe(1778);
    expect(ssEntryPreview(paul, null, douglas)!.otherPiaMonthly).toBeNull();
  });
});

describe("ssDraftRow", () => {
  const base = {
    unit: "monthly" as const, statedAge: { years: 70, months: 6 }, claimingAge: 67, claimingAgeMonths: 0,
    claimingAgeMode: "years" as const, owner: "client" as const, id: "d", year: 2026,
  };
  it("stated: canonical annual amount and the stated age set", () => {
    const row = ssDraftRow({ ...base, amount: "5706.5", mode: "manual_amount" });
    expect(row.annualAmount).toBeCloseTo(68478, 6);
    expect(row.piaMonthly).toBeUndefined();
    expect(row.ssStatedAge).toBe(70);
    expect(row.ssStatedAgeMonths).toBe(6);
  });
  it("PIA typed per year: monthly piaMonthly, no stated age", () => {
    const row = ssDraftRow({ ...base, amount: "36000", unit: "annual", mode: "pia_at_fra" });
    expect(row.piaMonthly).toBe(3000);
    expect(row.annualAmount).toBe(0);
    expect(row.ssStatedAge).toBeNull();
    expect(row.ssStatedAgeMonths).toBeNull();
  });
});

describe("claimTracksStatedAge", () => {
  const stated = { years: 67, months: 0 };
  it("is true when the claim age equals the stated age", () => {
    expect(claimTracksStatedAge({ claimingAgeMode: "years", claimingAge: 67, claimingAgeMonths: 0 }, stated)).toBe(true);
  });
  it("is false when they differ", () => {
    expect(claimTracksStatedAge({ claimingAgeMode: "years", claimingAge: 68, claimingAgeMonths: 0 }, stated)).toBe(false);
    expect(claimTracksStatedAge({ claimingAgeMode: "years", claimingAge: 67, claimingAgeMonths: 3 }, stated)).toBe(false);
  });
  it("is false when the claim mode is not a specific age", () => {
    expect(claimTracksStatedAge({ claimingAgeMode: "fra", claimingAge: 67, claimingAgeMonths: 0 }, stated)).toBe(false);
  });
});
