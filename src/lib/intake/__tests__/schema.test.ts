import { describe, it, expect } from "vitest";
import { intakeSubmitSchema, intakeDraftSchema, maritalToFilingStatus } from "../schema";

describe("intake schema", () => {
  it("accepts a complete submission", () => {
    const ok = intakeSubmitSchema.safeParse({
      family: {
        primary: { firstName: "Cooper", lastName: "Sample", dateOfBirth: "1975-06-20", maritalStatus: "married" },
        spouse: { firstName: "Susan", lastName: "Sample", dateOfBirth: "1979-01-01", maritalStatus: "married" },
        stateOfResidence: "PA",
        children: [{ firstName: "Caroline", lastName: "Sample", dateOfBirth: "2015-05-05" }],
      },
      accounts: [{ name: "401k", category: "retirement", value: 1200000 }],
      income: [{ name: "Cooper's Salary", type: "salary", annualAmount: 200000, owner: "client" }],
      property: [{ name: "Home", kind: "real_estate", value: 650000 }],
      goals: { clientRetirementAge: 65, spouseRetirementAge: 61, annualRetirementExpenses: 145000 },
      meta: { completedSections: ["family", "assets", "goals"] },
    });
    expect(ok.success).toBe(true);
  });

  it("rejects submission missing primary DOB", () => {
    const bad = intakeSubmitSchema.safeParse({ family: { primary: { firstName: "A", lastName: "B" }, children: [] } });
    expect(bad.success).toBe(false);
  });

  it("draft schema tolerates a half-filled payload", () => {
    const draft = intakeDraftSchema.safeParse({ family: { children: [] }, accounts: [] });
    expect(draft.success).toBe(true);
  });

  it("caps array lengths", () => {
    const tooMany = intakeSubmitSchema.safeParse({
      family: { primary: { firstName: "A", lastName: "B", dateOfBirth: "1975-06-20" }, children: [] },
      accounts: Array.from({ length: 51 }, () => ({ name: "x", category: "cash", value: 1 })),
    });
    expect(tooMany.success).toBe(false);
  });

  it("maps marital status to filing status", () => {
    expect(maritalToFilingStatus("married")).toBe("married_joint");
    expect(maritalToFilingStatus("single")).toBe("single");
    expect(maritalToFilingStatus("widowed")).toBe("single");
  });
});
