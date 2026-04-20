import { describe, it, expect } from "vitest";
import { computePlanEndAge } from "../plan-horizon";

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
