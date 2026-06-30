import { describe, it, expect } from "vitest";
import { assembleImportMilestones } from "@/lib/imports/import-milestones";

const base = {
  retirementAge: 65,
  planEndAge: 95,
  spouseRetirementAge: null,
  // Use mid-year DOBs: "YYYY-01-01" parses as UTC midnight → Dec 31 in Pacific
  // timezone, making getFullYear() return YYYY-1 and breaking the arithmetic.
  primary: { firstName: "John", dateOfBirth: "1970-06-15" },
  spouse: undefined,
  planStartYear: 2026,
  planEndYear: 2061,
};

describe("assembleImportMilestones", () => {
  it("builds milestones from primary + settings", () => {
    const out = assembleImportMilestones(base)!;
    expect(out.clientFirstName).toBe("John");
    expect(out.milestones.planStart).toBe(2026);
    expect(out.milestones.planEnd).toBe(2061);
    expect(out.milestones.clientRetirement).toBe(2035); // 1970 + 65
    expect(out.milestones.clientEnd).toBe(2065); // 1970 + 95
  });

  it("includes spouse milestones when spouse data is present", () => {
    const out = assembleImportMilestones({
      ...base,
      spouseRetirementAge: 67,
      spouse: { firstName: "Jane", dateOfBirth: "1972-06-15" },
    })!;
    expect(out.spouseFirstName).toBe("Jane");
    expect(out.milestones.spouseRetirement).toBe(2039); // 1972 + 67
  });

  it("returns null when the primary contact has no DOB", () => {
    expect(
      assembleImportMilestones({ ...base, primary: { firstName: "John", dateOfBirth: null } }),
    ).toBeNull();
  });
});
