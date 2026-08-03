import { describe, it, expect } from "vitest";
import { effectiveSurplusSpendPct } from "../surplus-spend";
import type { ClientInfo, PlanSettings } from "../types";

// Born 1970, retires at 65 → first retirement year 2035.
const CLIENT: ClientInfo = {
  firstName: "Test",
  lastName: "Client",
  dateOfBirth: "1970-01-01",
  retirementAge: 65,
  planEndAge: 95,
  filingStatus: "single",
};

const settings = (over: Partial<PlanSettings> = {}): PlanSettings => ({
  flatFederalRate: 0,
  flatStateRate: 0,
  inflationRate: 0,
  planStartYear: 2026,
  planEndYear: 2060,
  ...over,
});

describe("effectiveSurplusSpendPct", () => {
  it("returns the stored pct in every year when the flag is off", () => {
    const ps = settings({ surplusSpendPct: 0.25 });
    expect(effectiveSurplusSpendPct(ps, CLIENT, 2026)).toBe(0.25); // pre-retirement
    expect(effectiveSurplusSpendPct(ps, CLIENT, 2035)).toBe(0.25); // retirement year
    expect(effectiveSurplusSpendPct(ps, CLIENT, 2050)).toBe(0.25); // post-retirement
  });

  it("returns 1 strictly before the first retirement year when the flag is on", () => {
    const ps = settings({ surplusSpendPct: 0.25, surplusSpendAllUntilRetirement: true });
    expect(effectiveSurplusSpendPct(ps, CLIENT, 2026)).toBe(1);
    expect(effectiveSurplusSpendPct(ps, CLIENT, 2034)).toBe(1);
  });

  it("returns the stored pct in the retirement year itself", () => {
    const ps = settings({ surplusSpendPct: 0.25, surplusSpendAllUntilRetirement: true });
    expect(effectiveSurplusSpendPct(ps, CLIENT, 2035)).toBe(0.25);
    expect(effectiveSurplusSpendPct(ps, CLIENT, 2036)).toBe(0.25);
  });

  it("uses the FIRST retirement year when the spouse retires earlier", () => {
    const couple: ClientInfo = {
      ...CLIENT,
      spouseDob: "1975-01-01",
      spouseRetirementAge: 55, // → 2030
    };
    const ps = settings({ surplusSpendPct: 0, surplusSpendAllUntilRetirement: true });
    expect(effectiveSurplusSpendPct(ps, couple, 2029)).toBe(1);
    expect(effectiveSurplusSpendPct(ps, couple, 2030)).toBe(0);
  });

  it("falls back to the stored pct when no retirement year resolves", () => {
    const noDob: ClientInfo = { ...CLIENT, dateOfBirth: "" };
    const ps = settings({ surplusSpendPct: 0.25, surplusSpendAllUntilRetirement: true });
    expect(effectiveSurplusSpendPct(ps, noDob, 2026)).toBe(0.25);
  });

  it("defaults a missing stored pct to 0", () => {
    expect(effectiveSurplusSpendPct(settings(), CLIENT, 2026)).toBe(0);
  });

  it("clamps the stored pct into 0..1", () => {
    expect(effectiveSurplusSpendPct(settings({ surplusSpendPct: 1.5 }), CLIENT, 2026)).toBe(1);
    expect(effectiveSurplusSpendPct(settings({ surplusSpendPct: -0.2 }), CLIENT, 2026)).toBe(0);
  });
});
