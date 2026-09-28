import { describe, it, expect } from "vitest";
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
});
