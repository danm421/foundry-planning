import { describe, it, expect } from "vitest";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";

const validValue = {
  id: "goal-1",
  name: "College — Emma",
  type: "education",
  annualAmount: 30_000,
  startYear: 2032,
  endYear: 2035,
  growthRate: 0.05,
  dedicatedAccountIds: ["529-emma"],
  payShortfallOutOfPocket: false,
};

describe("SOLVER_MUTATION_SCHEMA — expense-upsert", () => {
  it("accepts a valid education-goal upsert", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "expense-upsert",
      id: "goal-1",
      value: validValue,
    });
    expect(r.success).toBe(true);
  });

  it("accepts a null value (remove)", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({ kind: "expense-upsert", id: "goal-1", value: null });
    expect(r.success).toBe(true);
  });

  it("rejects a bad type", () => {
    const r = SOLVER_MUTATION_SCHEMA.safeParse({
      kind: "expense-upsert",
      id: "goal-1",
      value: { ...validValue, type: "nope" },
    });
    expect(r.success).toBe(false);
  });
});
