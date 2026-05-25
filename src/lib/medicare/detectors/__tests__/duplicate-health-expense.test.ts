import { describe, it, expect } from "vitest";
import { duplicateHealthExpense } from "../duplicate-health-expense";

describe("duplicate-health-expense", () => {
  it("fires when a matching expense continues past enrollment", () => {
    const result = duplicateHealthExpense({
      years: [],
      expenses: [
        { id: "e1", name: "Health Insurance", annualAmount: 14_400, startYear: 2020, endYear: 2050, endsAtMedicareEligibilityOwner: null },
      ],
      medicareCoverage: [{ owner: "client", enrollmentYear: 2030 }],
      rmdStartAges: { client: 73 },
    });
    expect(result).not.toBeNull();
    expect(result!.id).toBe("duplicate-expense");
  });

  it("does not fire when expense is flagged endsAtMedicareEligibility", () => {
    const result = duplicateHealthExpense({
      years: [],
      expenses: [
        { id: "e1", name: "Health Insurance", annualAmount: 14_400, startYear: 2020, endYear: 2050, endsAtMedicareEligibilityOwner: "client" },
      ],
      medicareCoverage: [{ owner: "client", enrollmentYear: 2030 }],
      rmdStartAges: { client: 73 },
    });
    expect(result).toBeNull();
  });

  it("does not fire when name does not match health pattern", () => {
    const result = duplicateHealthExpense({
      years: [],
      expenses: [
        { id: "e1", name: "Travel", annualAmount: 14_400, startYear: 2020, endYear: 2050, endsAtMedicareEligibilityOwner: null },
      ],
      medicareCoverage: [{ owner: "client", enrollmentYear: 2030 }],
      rmdStartAges: { client: 73 },
    });
    expect(result).toBeNull();
  });

  it("does not fire when expense ends before enrollment", () => {
    const result = duplicateHealthExpense({
      years: [],
      expenses: [
        { id: "e1", name: "Health Insurance", annualAmount: 14_400, startYear: 2020, endYear: 2025, endsAtMedicareEligibilityOwner: null },
      ],
      medicareCoverage: [{ owner: "client", enrollmentYear: 2030 }],
      rmdStartAges: { client: 73 },
    });
    expect(result).toBeNull();
  });
});
