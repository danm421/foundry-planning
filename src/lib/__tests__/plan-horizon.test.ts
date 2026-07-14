import { describe, it, expect } from "vitest";
import type { ClientData } from "@/engine/types";
import {
  applyLifeExpectancyHorizon,
  computePlanEndAge,
} from "../plan-horizon";

describe("computePlanEndAge", () => {
  it("returns client LE when single", () => {
    const age = computePlanEndAge({
      clientDob: "1960-01-01",
      clientLifeExpectancy: 95,
      spouseDob: null,
      spouseLifeExpectancy: null,
    });
    expect(age).toBe(95);
  });

  it("follows the last-spouse-to-die when spouse outlives client", () => {
    // Client born 1960, LE 90 → dies 2050 (age 90)
    // Spouse born 1965, LE 95 → dies 2060 (client would be 100)
    const age = computePlanEndAge({
      clientDob: "1960-01-01",
      clientLifeExpectancy: 90,
      spouseDob: "1965-01-01",
      spouseLifeExpectancy: 95,
    });
    expect(age).toBe(100);
  });

  it("follows client when client outlives spouse", () => {
    // Client born 1960, LE 100 → dies 2060 (age 100)
    // Spouse born 1965, LE 90 → dies 2055 (client would be 95)
    const age = computePlanEndAge({
      clientDob: "1960-01-01",
      clientLifeExpectancy: 100,
      spouseDob: "1965-01-01",
      spouseLifeExpectancy: 90,
    });
    expect(age).toBe(100);
  });

  it("defaults missing spouse LE to 95", () => {
    // Client born 1960, LE 85 → dies 2045 (age 85)
    // Spouse born 1962, LE null (defaults 95) → dies 2057 (client would be 97)
    const age = computePlanEndAge({
      clientDob: "1960-01-01",
      clientLifeExpectancy: 85,
      spouseDob: "1962-01-01",
      spouseLifeExpectancy: null,
    });
    expect(age).toBe(97);
  });
});

describe("applyLifeExpectancyHorizon", () => {
  /** Minimal tree with the horizon-relevant fields; cast for a focused test. */
  function tree(over: {
    dateOfBirth?: string | null;
    lifeExpectancy?: number | null;
    spouseDob?: string | null;
    spouseLifeExpectancy?: number | null;
    planEndAge?: number;
    planEndYear: number;
  }): ClientData {
    return {
      client: {
        dateOfBirth: over.dateOfBirth,
        lifeExpectancy: over.lifeExpectancy,
        spouseDob: over.spouseDob,
        spouseLifeExpectancy: over.spouseLifeExpectancy,
        planEndAge: over.planEndAge,
      },
      planSettings: { planStartYear: 2026, planEndYear: over.planEndYear },
    } as unknown as ClientData;
  }

  it("re-derives a stale planEndYear from the last-spouse-to-die", () => {
    // Primary born 1975 (LE 95 → dies 2070), spouse born 1979 (LE 95 → dies
    // 2074). Stored planEndYear (2070) lags the survivor's death year (2074).
    const input = tree({
      dateOfBirth: "1975-06-20",
      lifeExpectancy: 95,
      spouseDob: "1979-06-01",
      spouseLifeExpectancy: 95,
      planEndAge: 95,
      planEndYear: 2070,
    });
    const out = applyLifeExpectancyHorizon(input);
    expect(out.planSettings.planEndYear).toBe(2074);
    expect(out.client.planEndAge).toBe(99); // 2074 - 1975
    // Pure: the input tree is untouched.
    expect(input.planSettings.planEndYear).toBe(2070);
  });

  it("is a no-op for a tree whose stored horizon already matches", () => {
    const input = tree({
      dateOfBirth: "1975-06-20",
      lifeExpectancy: 95,
      spouseDob: null,
      spouseLifeExpectancy: null,
      planEndAge: 95,
      planEndYear: 2070, // 1975 + 95
    });
    const out = applyLifeExpectancyHorizon(input);
    expect(out.planSettings.planEndYear).toBe(2070);
    expect(out.client.planEndAge).toBe(95);
  });

  it("returns the same reference when no DOB can be parsed", () => {
    const input = tree({ dateOfBirth: null, planEndYear: 2070 });
    expect(applyLifeExpectancyHorizon(input)).toBe(input);
  });
});
