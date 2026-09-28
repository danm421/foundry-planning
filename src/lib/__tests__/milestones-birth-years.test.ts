import { describe, it, expect, vi } from "vitest";
import { buildClientMilestones } from "../milestones";

describe("buildClientMilestones — birth years", () => {
  it("exposes the client's and spouse's birth years", () => {
    const m = buildClientMilestones(
      { dateOfBirth: "1975-06-15", retirementAge: 65, planEndAge: 95, spouseDob: "1978-02-01", spouseRetirementAge: 65 },
      2026, 2070,
    );
    expect(m.clientBirthYear).toBe(1975);
    expect(m.spouseBirthYear).toBe(1978);
  });
  it("keeps the spouse birth year even without a spouse retirement age", () => {
    const m = buildClientMilestones(
      { dateOfBirth: "1975-06-15", retirementAge: 65, planEndAge: 95, spouseDob: "1978-02-01", spouseRetirementAge: null },
      2026, 2070,
    );
    expect(m.spouseBirthYear).toBe(1978);
  });
  it("reads a Jan-1 birth year off the date string, as the projection does, west of UTC", () => {
    // A date-only string parses as UTC midnight, so `new Date(dob).getFullYear()`
    // reads Jan 1 as the prior year in a US zone. Pin one so the trap is live on
    // any machine — a UTC runner would otherwise pass vacuously.
    vi.stubEnv("TZ", "America/New_York");
    try {
      expect(new Date("1975-01-01").getFullYear()).toBe(1974); // the trap is live
      const dob = "1975-01-01";
      const spouseDob = "1978-01-01";
      const m = buildClientMilestones({ dateOfBirth: dob, retirementAge: 65, planEndAge: 95, spouseDob, spouseRetirementAge: 65 }, 2026, 2070);
      // projection.ts: parseInt(client.dateOfBirth.slice(0, 4), 10)
      expect(m.clientBirthYear).toBe(parseInt(dob.slice(0, 4), 10));
      expect(m.spouseBirthYear).toBe(parseInt(spouseDob.slice(0, 4), 10));
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
